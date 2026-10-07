// Committee voting for the strata portal. A separate Apps Script project (same
// one-concern-per-project pattern as Code.gs / OwnershipAudit.gs), deployed as
// a web app under the committee's secretary account (execute as: me, access:
// anyone). Every request carries the caller's Google ID token, which is
// verified here, so a vote can only ever be cast as the person Google says is
// signed in.
//
// Storage is one Google Sheet, "Strata Votes (Ledger)", owned by the secretary
// account. Its single "Ledger" tab is an append-only, hash-chained log: each
// entry's hash covers its own fields plus the previous entry's hash, so
// editing or deleting any past row breaks every hash after it. Proposals,
// votes and closes are all ledger entries; nothing else is stored, current
// state is always replayed from the ledger.
//
// Setup (once, from the Apps Script editor, signed in as the secretary):
// run setupVoting(), then Deploy > New deployment > Web app.

const CLIENT_ID = '983495642617-v0a00ou5rj018d2vjp0veqq0kjuk29je.apps.googleusercontent.com';
const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const PORTAL_URL = 'https://9acambridgestreet.github.io/strata-portal/';
const MEMBER_CACHE_SECONDS = 60;
const FRESH_TOKEN_SECONDS = 30 * 60; // a raw Google token must be this fresh to write
const SESSION_DAYS = 30; // how long a vote pass (see mintSession) lasts
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const CHOICES = ['FOR', 'AGAINST', 'ABSTAIN'];
const LEDGER_HEADERS = ['seq', 'timestamp', 'type', 'proposalId', 'actor', 'evidence', 'data', 'prevHash', 'hash'];
const MIN_OPEN_MINUTES = 5;
const MAX_OPEN_DAYS = 90;

function doGet() {
  return json({ service: 'strata-portal-voting' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'bad_request' });
  }
  try {
    return json(handle(req));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json({ error: 'server_error' });
  }
}

function handle(req) {
  const who = authenticate(req.token);
  if (who.error) return { error: who.error };

  // Trade a Google sign-in for a vote pass. Only a real Google token can mint
  // one, never another pass.
  if (req.action === 'session') {
    if (who.via !== 'google') return { error: 'invalid_token' };
    return mintSession(who);
  }

  const isWrite = req.action === 'create' || req.action === 'vote' || req.action === 'close';
  if (isWrite && who.via === 'google' && who.ageSeconds > FRESH_TOKEN_SECONDS) return { error: 'token_stale' };

  closeExpiredProposals();

  switch (req.action) {
    case 'list': return listProposals(who);
    case 'ledger': return ledgerDump();
    case 'create': return createProposal(who, req);
    case 'vote': return castVote(who, req);
    case 'close': return closeProposal(who, req);
    default: return { error: 'unknown_action' };
  }
}

// --- Identity: same checks as Code.gs's checkMember() ---

function authenticate(token) {
  if (!token) return { error: 'missing_token' };
  if (String(token).indexOf('S1.') === 0) return authenticateSession(token);
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return { error: 'invalid_token' };

  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) return { error: 'wrong_audience' };
  if (String(info.email_verified) !== 'true') return { error: 'unverified_email' };

  const email = String(info.email).toLowerCase();
  if (memberEmails().indexOf(email) === -1) return { error: 'not_member' };

  rememberName(email, info.name);

  const iat = Number(info.iat);
  return {
    email: email,
    sub: String(info.sub),
    iat: iat,
    ageSeconds: Math.floor(Date.now() / 1000) - iat,
    via: 'google',
  };
}

// --- Names ---
// The ledger always records the verified email address, which is the identity
// Google proved. People see display names instead: Google puts the name from
// the account profile in every ID token, so each sign-in refreshes this
// email-to-name list, kept in the "names" Script Property. Someone who has
// never signed in shows as the part of their email before the @, until their
// first sign-in fills it in. Departed members stay in the list so their old
// votes still read properly.

function readNames() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('names') || '{}');
  } catch (err) {
    return {};
  }
}

function rememberName(email, name) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) return;
  if (readNames()[email] === name) return;
  withLock(function () {
    const fresh = readNames();
    fresh[email] = name;
    PropertiesService.getScriptProperties().setProperty('names', JSON.stringify(fresh));
  });
}

function nameOf(email, names) {
  const map = names || readNames();
  if (map[email]) return map[email];
  const local = String(email).split('@')[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// --- Vote pass ---
// The portal only signs a member in with Google once, then remembers them in
// the browser. To vote without a second Google prompt, the portal trades that
// one sign-in for a "vote pass": a token signed by this script (HMAC-SHA256
// with a secret only this project knows) that names the member and expires in
// SESSION_DAYS. Membership is still checked live against the Drive folder on
// every request, so removing someone from the folder ends their access
// immediately, pass or no pass. Deleting the sessionSecret Script Property
// invalidates every pass at once.

function sessionSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('sessionSecret');
  if (secret) return secret;
  return withLock(function () {
    let again = props.getProperty('sessionSecret');
    if (!again) {
      again = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('sessionSecret', again);
    }
    return again;
  });
}

function signPayload(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sessionSecret()));
}

function mintSession(who) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_DAYS * 86400;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: who.email, s: who.sub, i: now, x: exp }));
  return { session: 'S1.' + payload + '.' + signPayload(payload), email: who.email, expiresAt: exp * 1000 };
}

function authenticateSession(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { error: 'invalid_token' };
  if (signPayload(parts[1]) !== parts[2]) return { error: 'invalid_token' };

  let data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
  } catch (err) {
    return { error: 'invalid_token' };
  }
  if (!data.e || Math.floor(Date.now() / 1000) >= Number(data.x)) return { error: 'invalid_token' };
  if (memberEmails().indexOf(String(data.e).toLowerCase()) === -1) return { error: 'not_member' };

  return { email: String(data.e).toLowerCase(), sub: String(data.s), iat: Number(data.i), ageSeconds: 0, via: 'session' };
}

function memberEmails() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('members');
  if (cached) return JSON.parse(cached);

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const people = [folder.getOwner()].concat(folder.getEditors(), folder.getViewers());
  const emails = people
    .filter(function (p) { return p; })
    .map(function (p) { return p.getEmail().toLowerCase(); });

  cache.put('members', JSON.stringify(emails), MEMBER_CACHE_SECONDS);
  return emails;
}

// --- Ledger ---

function ledgerSheet() {
  const id = PropertiesService.getScriptProperties().getProperty('votesSheetId');
  if (!id) throw new Error('votesSheetId not set, run setupVoting() first');
  return SpreadsheetApp.openById(id).getSheetByName('Ledger');
}

function readLedger() {
  const sheet = ledgerSheet();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, LEDGER_HEADERS.length).getValues().map(function (row) {
    const entry = {};
    LEDGER_HEADERS.forEach(function (h, i) { entry[h] = String(row[i]); });
    return entry;
  });
}

// The exact string hashed for each entry. js/votes.js recomputes this in the
// browser to verify the chain independently, so the two must stay identical.
function canonicalEntry(e) {
  return JSON.stringify([
    String(e.seq), e.timestamp, e.type, e.proposalId, e.actor, e.evidence, e.data, e.prevHash,
  ]);
}

function sha256Hex(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

// Caller must hold the script lock. Re-reads the ledger tail itself so two
// near-simultaneous votes can never both chain onto the same previous hash.
function appendEntry(type, proposalId, actor, evidence, data) {
  const sheet = ledgerSheet();
  const last = sheet.getLastRow();
  let prevHash = GENESIS_HASH;
  if (last >= 2) prevHash = String(sheet.getRange(last, LEDGER_HEADERS.length).getValue());

  const entry = {
    seq: String(Math.max(last - 1, 0) + 1), // data rows start at sheet row 2, so row N holds seq N-1
    timestamp: new Date().toISOString(),
    type: type,
    proposalId: proposalId,
    actor: actor,
    evidence: evidence,
    data: data,
    prevHash: prevHash,
  };
  entry.hash = sha256Hex(canonicalEntry(entry));

  const row = Math.max(last, 1) + 1;
  const range = sheet.getRange(row, 1, 1, LEDGER_HEADERS.length);
  range.setNumberFormat('@'); // plain text, so a title starting with "=" is never a formula
  range.setValues([LEDGER_HEADERS.map(function (h) { return entry[h]; })]);
  SpreadsheetApp.flush();
  return entry;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// --- State, replayed from the ledger ---

function buildState(entries) {
  const proposals = {};
  const order = [];
  entries.forEach(function (e) {
    if (e.type === 'PROPOSAL') {
      const d = JSON.parse(e.data);
      proposals[e.proposalId] = {
        id: e.proposalId,
        title: d.title,
        description: d.description,
        docLink: d.docLink,
        closesAt: d.closesAt,
        createdBy: e.actor,
        createdAt: e.timestamp,
        status: 'open',
        votes: {},
      };
      order.push(e.proposalId);
    } else if (e.type === 'VOTE') {
      const p = proposals[e.proposalId];
      if (p && p.status === 'open') {
        p.votes[e.actor] = { voter: e.actor, choice: e.data, timestamp: e.timestamp, seq: e.seq, hash: e.hash };
      }
    } else if (e.type === 'CLOSE') {
      const p = proposals[e.proposalId];
      if (p && p.status === 'open') {
        p.status = 'closed';
        p.closedAt = e.timestamp;
        p.closedBy = e.actor;
        p.closeHash = e.hash;
        p.closeSeq = e.seq;
      }
    }
  });
  return { proposals: proposals, order: order };
}

function tally(proposal) {
  const t = { FOR: 0, AGAINST: 0, ABSTAIN: 0 };
  Object.keys(proposal.votes).forEach(function (v) { t[proposal.votes[v].choice]++; });
  // Simple majority of those voting; abstentions don't count either way.
  t.outcome = t.FOR > t.AGAINST ? 'PASSED' : (t.FOR < t.AGAINST ? 'NOT PASSED' : 'TIED (NOT PASSED)');
  return t;
}

function publicProposal(p, me, names) {
  const votes = Object.keys(p.votes).map(function (k) {
    const v = p.votes[k];
    return { voter: v.voter, voterName: nameOf(v.voter, names), choice: v.choice, timestamp: v.timestamp, seq: v.seq, hash: v.hash };
  });
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    docLink: p.docLink,
    createdBy: p.createdBy,
    createdByName: nameOf(p.createdBy, names),
    createdAt: p.createdAt,
    closesAt: p.closesAt,
    status: p.status,
    closedAt: p.closedAt || null,
    closedBy: p.closedBy || null,
    closeHash: p.closeHash || null,
    votes: votes,
    tally: tally(p),
    myVote: p.votes[me] ? p.votes[me].choice : null,
  };
}

// --- Actions ---

function listProposals(who) {
  const state = buildState(readLedger());
  const names = readNames();
  return {
    me: who.email,
    meName: nameOf(who.email, names),
    proposals: state.order.slice().reverse().map(function (id) {
      return publicProposal(state.proposals[id], who.email, names);
    }),
  };
}

function ledgerDump() {
  const entries = readLedger();
  return { entries: entries, head: entries.length ? entries[entries.length - 1].hash : GENESIS_HASH, names: readNames() };
}

function evidenceFor(who) {
  // Google's own account id, the time that identity was verified (the Google
  // sign-in, or the vote pass minted from it) and which of the two was used,
  // kept in the ledger as proof of which signed-in identity cast the entry.
  return who.sub + '|' + who.iat + '|' + who.via;
}

function createProposal(who, req) {
  const title = String(req.title || '').trim();
  const description = String(req.description || '').trim();
  const docLink = String(req.docLink || '').trim();
  if (!title || title.length > 200) return { error: 'bad_title' };
  if (description.length > 5000) return { error: 'bad_description' };
  if (docLink && !/^https:\/\/(docs|drive)\.google\.com\//.test(docLink)) return { error: 'bad_doc_link' };

  const closes = new Date(req.closesAt);
  if (isNaN(closes.getTime())) return { error: 'bad_close_date' };
  const now = Date.now();
  if (closes.getTime() < now + MIN_OPEN_MINUTES * 60000) return { error: 'close_date_too_soon' };
  if (closes.getTime() > now + MAX_OPEN_DAYS * 86400000) return { error: 'close_date_too_far' };

  const entry = withLock(function () {
    const state = buildState(readLedger());
    const id = 'P' + (state.order.length + 1);
    return appendEntry('PROPOSAL', id, who.email, evidenceFor(who), JSON.stringify({
      title: title,
      description: description,
      docLink: docLink,
      closesAt: closes.toISOString(),
    }));
  });

  safeMail(memberEmails(), 'New committee proposal: ' + title,
    nameOf(who.email) + ' has put a proposal to the committee.\n\n' +
    title + '\n' + (description ? '\n' + description + '\n' : '') +
    '\nVoting closes: ' + sydney(closes.toISOString()) + '\n' +
    '\nVote in the portal: ' + PORTAL_URL + '\n');

  return { ok: true, id: entry.proposalId };
}

function castVote(who, req) {
  const choice = String(req.choice || '').toUpperCase();
  if (CHOICES.indexOf(choice) === -1) return { error: 'bad_choice' };

  const result = withLock(function () {
    const state = buildState(readLedger());
    const p = state.proposals[req.proposalId];
    if (!p) return { error: 'no_such_proposal' };
    if (p.status !== 'open' || Date.now() >= new Date(p.closesAt).getTime()) return { error: 'voting_closed' };
    if (p.votes[who.email] && p.votes[who.email].choice === choice) return { ok: true, unchanged: true };
    const entry = appendEntry('VOTE', p.id, who.email, evidenceFor(who), choice);
    return { ok: true, entry: entry, title: p.title };
  });
  if (!result.entry) return result;

  const e = result.entry;
  safeMail([who.email], 'Your vote receipt: ' + result.title,
    'Your vote has been recorded.\n\n' +
    'Proposal: ' + result.title + ' (' + e.proposalId + ')\n' +
    'Your vote: ' + e.data + '\n' +
    'Recorded: ' + sydney(e.timestamp) + '\n' +
    'Ledger entry: ' + e.seq + '\n' +
    'Entry hash: ' + e.hash + '\n\n' +
    'Keep this email. If the ledger entry for your vote ever shows a different choice or hash, ' +
    'this receipt proves what was recorded. You can change your vote until voting closes; ' +
    'each change is a new ledger entry and gets its own receipt.\n');

  return { ok: true, seq: e.seq, hash: e.hash };
}

function closeProposal(who, req) {
  const result = withLock(function () {
    const state = buildState(readLedger());
    const p = state.proposals[req.proposalId];
    if (!p) return { error: 'no_such_proposal' };
    if (p.status !== 'open') return { error: 'already_closed' };
    if (p.createdBy !== who.email) return { error: 'not_creator' };
    return { entry: appendClose(p, who.email, evidenceFor(who)) };
  });
  if (!result.entry) return result;
  mailClosed(result.entry);
  return { ok: true };
}

// --- Closing ---

function appendClose(proposal, actor, evidence) {
  const t = tally(proposal);
  return appendEntry('CLOSE', proposal.id, actor, evidence, JSON.stringify({
    for: t.FOR, against: t.AGAINST, abstain: t.ABSTAIN, outcome: t.outcome,
  }));
}

// Closes every proposal whose time has passed. Called at the start of each
// request and hourly by the trigger from setupVoting(), so a proposal never
// stays "open" in the ledger after its deadline once anyone looks.
function closeExpiredProposals() {
  const now = Date.now();
  const expired = buildState(readLedger());
  const due = expired.order.filter(function (id) {
    const p = expired.proposals[id];
    return p.status === 'open' && now >= new Date(p.closesAt).getTime();
  });
  if (!due.length) return;

  const closed = withLock(function () {
    const state = buildState(readLedger());
    const out = [];
    state.order.forEach(function (id) {
      const p = state.proposals[id];
      if (p.status === 'open' && Date.now() >= new Date(p.closesAt).getTime()) {
        out.push(appendClose(p, 'system', 'deadline'));
      }
    });
    return out;
  });
  closed.forEach(mailClosed);
}

function mailClosed(closeEntry) {
  const state = buildState(readLedger());
  const p = state.proposals[closeEntry.proposalId];
  const t = tally(p);
  const names = readNames();
  const lines = Object.keys(p.votes).map(function (k) {
    return '  ' + nameOf(p.votes[k].voter, names) + ': ' + p.votes[k].choice;
  });
  safeMail(memberEmails(), 'Vote closed: ' + p.title + ' (' + t.outcome + ')',
    'Voting has closed.\n\n' +
    p.title + ' (' + p.id + ')\n\n' +
    'Result: ' + t.outcome + '\n' +
    'For: ' + t.FOR + '   Against: ' + t.AGAINST + '   Abstain: ' + t.ABSTAIN + '\n\n' +
    'How each member voted:\n' + (lines.length ? lines.join('\n') : '  (no votes)') + '\n\n' +
    'Final ledger hash: ' + closeEntry.hash + '\n' +
    'Keep this email. Anyone can check the portal ledger against this hash: if any vote had ' +
    'been altered after this point, the hash would no longer match.\n\n' +
    PORTAL_URL + '\n');
}

// --- Helpers ---

function safeMail(recipients, subject, body) {
  try {
    const unique = recipients.filter(function (r, i) { return r && recipients.indexOf(r) === i; });
    if (!unique.length) return;
    MailApp.sendEmail({ to: unique.join(','), subject: subject, body: body });
  } catch (err) {
    console.error('mail failed: ' + err); // never let an email problem undo a recorded vote
  }
}

function sydney(iso) {
  return Utilities.formatDate(new Date(iso), 'Australia/Sydney', 'd MMM yyyy, h:mm a');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// --- One-time setup and manual checks ---

// Run once, signed in as the secretary account. Creates the ledger Sheet
// (owned by that account), records its id, and schedules the hourly close of
// expired proposals. Running it twice is safe: it refuses if a sheet is
// already recorded, and never duplicates the trigger.
function setupVoting() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('votesSheetId')) {
    Logger.log('Already set up: ' + SpreadsheetApp.openById(props.getProperty('votesSheetId')).getUrl());
    return;
  }

  const ss = SpreadsheetApp.create('Strata Votes (Ledger)');
  const sheet = ss.getSheets()[0];
  sheet.setName('Ledger');
  sheet.getRange(1, 1, sheet.getMaxRows(), LEDGER_HEADERS.length).setNumberFormat('@');
  sheet.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  props.setProperty('votesSheetId', ss.getId());

  // Only the owner (this script) should ever write to it.
  try {
    const protection = sheet.protect().setDescription('Append-only ledger, written by the Voting script only');
    protection.removeEditors(protection.getEditors().filter(function (u) {
      return u.getEmail() !== Session.getEffectiveUser().getEmail();
    }));
  } catch (err) {
    Logger.log('Could not restrict editors: ' + err);
  }

  const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'closeExpiredProposals';
  });
  if (!hasTrigger) ScriptApp.newTrigger('closeExpiredProposals').timeBased().everyHours(1).create();

  Logger.log('Ledger created: ' + ss.getUrl() + '\nDrag it into the Strata Committee Documents folder so members can view it.');
}

// Run from the editor to confirm the ledger chain is intact (also shown in
// the portal's Verify button, which recomputes it in the browser instead).
function testVerifyLedger() {
  const entries = readLedger();
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== String(i + 1) || e.prevHash !== prev || sha256Hex(canonicalEntry(e)) !== e.hash) {
      Logger.log('BROKEN at entry ' + (i + 1));
      return;
    }
    prev = e.hash;
  }
  Logger.log('Ledger intact: ' + entries.length + ' entries, head ' + prev);
}
