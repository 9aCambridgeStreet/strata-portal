// Committee voting tab. Talks to the Voting Apps Script (apps-script/Voting.gs).
// Every request carries a fresh Google ID token, so the server knows exactly
// which signed-in member is acting. The portal's saved session has no token
// (it is only used once, at sign-in), so this tab keeps one in memory: either
// the token from this visit's sign-in, or one from a "Sign in to vote" button.

const VOTES_TOKEN_MAX_AGE_MS = 25 * 60 * 1000;
const GENESIS_HASH = '0'.repeat(64);
const CHOICE_LABELS = { FOR: 'For', AGAINST: 'Against', ABSTAIN: 'Abstain' };

const votesState = { token: null, tokenAt: 0, panel: null, data: null, showAudit: false, showForm: false, busy: false };

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  });
  [].concat(children || []).forEach((child) => {
    if (child) node.append(child);
  });
  return node;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function shortHash(hash) {
  return hash ? hash.slice(0, 10) + '…' : '';
}

// A "vote pass": the voting script trades one Google sign-in for a token it
// signs itself, good for 30 days, so members never see a second sign-in. The
// script still checks committee membership on every request.
const VOTE_SESSION_KEY = 'strataPortal.voteSession';

function readVoteSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(VOTE_SESSION_KEY));
    const saved = (typeof loadSession === 'function' && loadSession()) || {};
    const sameUser = !saved.email || stored.email === String(saved.email).toLowerCase();
    if (stored && stored.token && stored.exp > Date.now() && sameUser) return stored;
  } catch (err) {
    // missing or unreadable, treated as no pass
  }
  return null;
}

function clearVoteSession() {
  try {
    localStorage.removeItem(VOTE_SESSION_KEY);
  } catch (err) {
    // storage blocked, nothing to clear
  }
}

async function votesMintSession(credential) {
  if (!CONFIG.votingUrl || !credential) return;
  try {
    const res = await fetch(CONFIG.votingUrl, { method: 'POST', body: JSON.stringify({ action: 'session', token: credential }) });
    const data = await res.json();
    if (data.session) {
      localStorage.setItem(VOTE_SESSION_KEY, JSON.stringify({ token: data.session, email: data.email, exp: data.expiresAt }));
    }
  } catch (err) {
    // No pass this time, voting falls back to asking for a Google sign-in.
  }
}

function votesToken() {
  const pass = readVoteSession();
  if (pass) return pass.token;
  if (votesState.token && Date.now() - votesState.tokenAt < VOTES_TOKEN_MAX_AGE_MS) return votesState.token;
  const fresh = window.portalCredential;
  if (fresh && Date.now() - fresh.at < VOTES_TOKEN_MAX_AGE_MS) {
    votesState.token = fresh.token;
    votesState.tokenAt = fresh.at;
    return fresh.token;
  }
  votesState.token = null;
  return null;
}

async function votesApi(action, body) {
  const token = votesToken();
  if (!token) return { error: 'missing_token' };
  const res = await fetch(CONFIG.votingUrl, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ action, token }, body || {})),
  });
  if (!res.ok) return { error: 'http_' + res.status };
  const data = await res.json();
  if (['invalid_token', 'token_stale', 'missing_token'].includes(data.error)) {
    votesState.token = null;
    if (token.indexOf('S1.') === 0) clearVoteSession(); // expired or revoked pass
  }
  return data;
}

const VOTES_ERRORS = {
  not_member: 'This account is not on the committee documents folder.',
  voting_closed: 'Voting on that proposal has closed.',
  bad_title: 'Give the proposal a title (up to 200 characters).',
  bad_description: 'The description is too long (5000 characters at most).',
  bad_doc_link: 'The document link must be a Google Docs or Drive link.',
  bad_close_date: 'Choose a valid closing date.',
  close_date_too_soon: 'The closing time must be at least 5 minutes from now.',
  close_date_too_far: 'The closing time must be within 90 days.',
  not_creator: 'Only the member who created a proposal can close it early.',
  server_error: 'Something went wrong on the server. Try again shortly.',
};

function votesErrorText(code) {
  return VOTES_ERRORS[code] || 'Something went wrong (' + code + ').';
}

function votesOpen(panel) {
  votesState.panel = panel;
  votesRefresh();
}

function votesMessage(text) {
  votesState.panel.replaceChildren(el('p', { class: 'votes-note', text }));
}

function votesSignIn(message, keepAutoSelect) {
  const button = el('div', { class: 'votes-signin-button' });
  // The portal remembers who is signed in, so hint that account to Google.
  // Without it a shared device offers whichever Google account it used last,
  // which on the committee iPad can be the secretary account.
  const saved = (typeof loadSession === 'function' && loadSession()) || {};
  const hint = saved.email || '';
  votesState.panel.replaceChildren(
    el('div', { class: 'votes-signin' }, [
      el('p', { class: 'votes-note', text: message || (hint ? `Confirm it is you: sign in with Google as ${saved.name || hint} to view and cast committee votes.` : 'Sign in with Google to view and cast committee votes.') }),
      button,
    ])
  );
  if (typeof google === 'undefined') {
    votesMessage('Could not reach Google to sign in. Check your connection and reload.');
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.googleClientId,
    login_hint: hint || undefined,
    auto_select: !!keepAutoSelect,
    callback: (response) => {
      let email = '';
      try {
        email = String(decodeJwt(response.credential).email || '').toLowerCase();
      } catch (err) {
        email = '';
      }
      // Never let a different Google account vote under this portal session.
      if (hint && email !== hint.toLowerCase()) {
        google.accounts.id.disableAutoSelect();
        votesSignIn(`You signed in to Google as ${email || 'a different account'}, but this portal is signed in as ${hint}. Choose ${hint} (use "Use another account" if it isn't listed).`, false);
        return;
      }
      votesState.token = response.credential;
      votesState.tokenAt = Date.now();
      votesMintSession(response.credential).then(votesRefresh);
    },
  });
  google.accounts.id.renderButton(button, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' });
  if (keepAutoSelect) google.accounts.id.prompt();
}

async function votesRefresh() {
  if (!votesToken()) {
    votesSignIn(votesState.data ? 'Your sign-in has timed out. Sign in again to continue.' : null, true);
    return;
  }
  if (!votesState.data) votesMessage('Loading votes…');
  let data;
  try {
    data = await votesApi('list');
  } catch (err) {
    votesMessage('Could not reach the voting service. Check your connection and try again.');
    return;
  }
  if (data.error) {
    if (data.error === 'missing_token' || data.error === 'invalid_token' || data.error === 'token_stale') {
      votesSignIn('Sign in again to continue.');
    } else {
      votesMessage(votesErrorText(data.error));
    }
    return;
  }
  votesState.data = data;
  votesRender();
}

function votesRender() {
  const { data } = votesState;
  const open = data.proposals.filter((p) => p.status === 'open');
  const closed = data.proposals.filter((p) => p.status === 'closed');

  const toolbar = el('div', { class: 'votes-toolbar' }, [
    el('button', { type: 'button', class: 'votes-btn primary', text: votesState.showForm ? 'Cancel' : 'New proposal', onclick: () => { votesState.showForm = !votesState.showForm; votesRender(); } }),
    el('button', { type: 'button', class: 'votes-btn', text: 'Refresh', onclick: votesRefresh }),
    el('button', { type: 'button', class: 'votes-btn', text: votesState.showAudit ? 'Hide audit ledger' : 'Audit ledger', onclick: () => { votesState.showAudit = !votesState.showAudit; votesRender(); } }),
  ]);

  const parts = [toolbar];
  if (votesState.showForm) parts.push(votesForm());
  if (votesState.showAudit) parts.push(votesAuditBox());
  parts.push(el('h2', { class: 'votes-heading', text: 'Open proposals' }));
  if (!open.length) parts.push(el('p', { class: 'votes-note', text: 'Nothing is open for voting right now.' }));
  open.forEach((p) => parts.push(proposalCard(p)));
  if (closed.length) {
    parts.push(el('h2', { class: 'votes-heading', text: 'Closed proposals' }));
    closed.forEach((p) => parts.push(proposalCard(p)));
  }
  votesState.panel.replaceChildren(el('div', { class: 'votes-wrap' }, parts));
}

function proposalCard(p) {
  const isOpen = p.status === 'open';
  const t = p.tally;
  const card = el('article', { class: 'vote-card' + (isOpen ? '' : ' is-closed') });

  card.append(el('h3', { text: p.title }));
  card.append(el('p', { class: 'vote-meta', text: `${p.id} · proposed by ${p.createdByName} · ${isOpen ? 'closes ' + fmtDate(p.closesAt) : 'closed ' + fmtDate(p.closedAt)}` }));
  if (p.description) card.append(el('p', { class: 'vote-desc', text: p.description }));
  if (p.docLink) card.append(el('p', {}, [el('a', { href: p.docLink, target: '_blank', rel: 'noopener', text: 'Read the supporting document ↗' })]));

  const counts = el('p', { class: 'vote-counts', text: `For ${t.FOR} · Against ${t.AGAINST} · Abstain ${t.ABSTAIN}` });
  card.append(counts);
  if (!isOpen) card.append(el('p', { class: 'vote-result ' + (t.outcome === 'PASSED' ? 'passed' : 'failed'), text: t.outcome }));

  if (isOpen) {
    const row = el('div', { class: 'vote-choices' });
    Object.keys(CHOICE_LABELS).forEach((choice) => {
      row.append(el('button', {
        type: 'button',
        class: 'votes-btn choice choice-' + choice.toLowerCase() + (p.myVote === choice ? ' is-mine' : ''),
        text: CHOICE_LABELS[choice],
        onclick: () => castVote(p, choice),
      }));
    });
    card.append(row);
    card.append(el('p', { class: 'vote-hint', text: p.myVote ? `You voted ${CHOICE_LABELS[p.myVote]}. You can change it until voting closes.` : 'You have not voted yet.' }));
    if (p.createdBy === votesState.data.me) {
      card.append(el('button', { type: 'button', class: 'votes-btn small', text: 'Close voting now', onclick: () => closeProposal(p) }));
    }
  }

  const list = el('ul', { class: 'vote-voters' });
  p.votes.forEach((v) => {
    list.append(el('li', {}, [
      el('span', { class: 'voter', text: v.voterName }),
      el('span', { class: 'choice-tag choice-' + v.choice.toLowerCase(), text: CHOICE_LABELS[v.choice] }),
      el('span', { class: 'vote-time', text: `${fmtDate(v.timestamp)} · entry ${v.seq} · ${shortHash(v.hash)}` }),
    ]));
  });
  card.append(el('details', { class: 'vote-detail' }, [
    el('summary', { role: 'button', text: `Who voted (${p.votes.length})` }),
    p.votes.length ? list : el('p', { class: 'votes-note', text: 'No votes yet.' }),
  ]));
  if (!isOpen) card.append(el('p', { class: 'vote-final', text: `Final ledger hash: ${p.closeHash}` }));
  return card;
}

async function castVote(p, choice) {
  if (votesState.busy) return;
  if (!confirm(`Cast your vote on "${p.title}": ${CHOICE_LABELS[choice]}?\n\nYou can change it until voting closes.`)) return;
  await votesAction(() => votesApi('vote', { proposalId: p.id, choice }), 'Your vote was recorded. A receipt has been emailed to you.');
}

async function closeProposal(p) {
  if (!confirm(`Close voting on "${p.title}" now? This cannot be undone.`)) return;
  await votesAction(() => votesApi('close', { proposalId: p.id }), 'Voting closed.');
}

async function votesAction(run, successText) {
  votesState.busy = true;
  let result;
  try {
    result = await run();
  } catch (err) {
    result = { error: 'server_error' };
  }
  votesState.busy = false;
  if (result.error === 'token_stale' || result.error === 'invalid_token' || result.error === 'missing_token') {
    votesSignIn('Please sign in again to confirm it is you, then repeat that action.');
    return;
  }
  if (result.error) {
    alert(votesErrorText(result.error));
    return;
  }
  if (successText) votesFlash(successText);
  await votesRefresh();
}

function votesFlash(text) {
  const note = el('div', { class: 'votes-flash', role: 'status', text });
  document.body.append(note);
  setTimeout(() => note.remove(), 5000);
}

function votesForm() {
  const defaultClose = new Date(Date.now() + 7 * 86400000);
  defaultClose.setMinutes(defaultClose.getMinutes() - defaultClose.getTimezoneOffset());
  const field = (label, input) => el('label', { class: 'votes-field' }, [el('span', { text: label }), input]);

  const title = el('input', { type: 'text', maxlength: '200', required: 'required' });
  const description = el('textarea', { rows: '5', maxlength: '5000' });
  const docLink = el('input', { type: 'url', placeholder: 'https://docs.google.com/…' });
  const closes = el('input', { type: 'datetime-local', value: defaultClose.toISOString().slice(0, 16) });

  const form = el('form', { class: 'votes-form' }, [
    el('h2', { class: 'votes-heading', text: 'New proposal' }),
    field('Title', title),
    field('What are we voting on?', description),
    field('Supporting document (optional)', docLink),
    field('Voting closes (Sydney time)', closes),
    el('p', { class: 'vote-hint', text: 'Everyone on the committee is emailed. Voting is by named ballot, simple majority of those voting, abstentions not counted.' }),
    el('button', { type: 'submit', class: 'votes-btn primary', text: 'Put to a vote' }),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (votesState.busy) return;
    const result = await (async () => {
      votesState.busy = true;
      try {
        return await votesApi('create', {
          title: title.value, description: description.value, docLink: docLink.value,
          closesAt: new Date(closes.value).toISOString(),
        });
      } catch (err) {
        return { error: 'server_error' };
      } finally {
        votesState.busy = false;
      }
    })();
    if (result.error === 'token_stale' || result.error === 'invalid_token' || result.error === 'missing_token') {
      votesSignIn('Please sign in again to confirm it is you, then put the proposal again.');
      return;
    }
    if (result.error) {
      alert(votesErrorText(result.error));
      return;
    }
    votesState.showForm = false;
    votesFlash('Proposal created and the committee has been emailed.');
    votesRefresh();
  });
  return form;
}

// --- Audit: recompute the hash chain in the browser, trusting nothing the server says ---

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Must match canonicalEntry() in apps-script/Voting.gs exactly.
function canonicalEntry(e) {
  return JSON.stringify([String(e.seq), e.timestamp, e.type, e.proposalId, e.actor, e.evidence, e.data, e.prevHash]);
}

async function verifyLedger(entries) {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== String(i + 1)) return { ok: false, at: i + 1, reason: 'an entry is missing or out of order' };
    if (e.prevHash !== prev) return { ok: false, at: i + 1, reason: 'it does not follow on from the entry before it' };
    if ((await sha256Hex(canonicalEntry(e))) !== e.hash) return { ok: false, at: i + 1, reason: 'its contents no longer match its hash' };
    prev = e.hash;
  }
  return { ok: true, count: entries.length, head: prev };
}

function votesAuditBox() {
  const out = el('div', { class: 'votes-audit-out' });
  const box = el('section', { class: 'votes-audit' }, [
    el('h2', { class: 'votes-heading', text: 'Audit ledger' }),
    el('p', { class: 'votes-note', text: 'Every proposal, vote and close is a numbered ledger entry whose hash covers the entry before it. Verify recomputes the whole chain here in your browser. Compare the head hash with the one in the "vote closed" emails and your own vote receipts.' }),
    el('div', { class: 'votes-toolbar' }, [
      el('button', { type: 'button', class: 'votes-btn primary', text: 'Verify ledger', onclick: () => runAudit(out, false) }),
      el('button', { type: 'button', class: 'votes-btn', text: 'Download CSV', onclick: () => runAudit(out, true) }),
    ]),
    out,
  ]);
  return box;
}

async function runAudit(out, download) {
  out.replaceChildren(el('p', { class: 'votes-note', text: 'Checking…' }));
  let data;
  try {
    data = await votesApi('ledger');
  } catch (err) {
    data = { error: 'server_error' };
  }
  if (data.error) {
    if (['missing_token', 'invalid_token', 'token_stale'].includes(data.error)) votesSignIn('Sign in again to continue.');
    else out.replaceChildren(el('p', { class: 'votes-note', text: votesErrorText(data.error) }));
    return;
  }
  const result = await verifyLedger(data.entries);
  const parts = [];
  if (result.ok) {
    parts.push(el('p', { class: 'audit-ok', text: `Ledger intact: ${result.count} entries.` }));
    parts.push(el('p', { class: 'vote-final', text: `Head hash: ${result.head}` }));
  } else {
    parts.push(el('p', { class: 'audit-bad', text: `LEDGER BROKEN at entry ${result.at}: ${result.reason}. Do not rely on results after this point, tell the secretary.` }));
  }

  const table = el('table', { class: 'audit-table' }, [
    el('thead', {}, [el('tr', {}, ['#', 'When', 'Type', 'Proposal', 'By', 'Data', 'Hash'].map((h) => el('th', { text: h })))]),
    el('tbody', {}, data.entries.map((e) => el('tr', {}, [
      e.seq, fmtDate(e.timestamp), e.type, e.proposalId, auditName(e.actor, data.names), e.data, shortHash(e.hash),
    ].map((c, i) => el('td', { text: c, title: i === 4 ? e.actor : '' }))))),
  ]);
  parts.push(el('div', { class: 'audit-scroll' }, [table]));
  out.replaceChildren(...parts);

  if (download) downloadLedgerCsv(data.entries);
}

// The ledger holds emails; people read names. The email stays on hover.
function auditName(actor, names) {
  return (names && names[actor]) || actor;
}

function downloadLedgerCsv(entries) {
  const cols = ['seq', 'timestamp', 'type', 'proposalId', 'actor', 'evidence', 'data', 'prevHash', 'hash'];
  // Leading = + - @ would run as a formula if the CSV is opened in Excel.
  const cell = (v) => '"' + String(v).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"';
  const csv = [cols.join(',')].concat(entries.map((e) => cols.map((c) => cell(e[c])).join(','))).join('\r\n');
  const link = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'strata-vote-ledger.csv' });
  document.body.append(link);
  link.click();
  link.remove();
}
