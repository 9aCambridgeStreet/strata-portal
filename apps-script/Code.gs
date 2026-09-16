// Membership check for the strata portal. Deployed as a web app under the
// committee's secretary account (execute as: me, access: anyone).
// A person is a member if the Strata Committee Documents folder is shared with them.

const CLIENT_ID = '983495642617-v0a00ou5rj018d2vjp0veqq0kjuk29je.apps.googleusercontent.com';
const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const MENU_SHEET_ID = '1RnmCjsRmNsnVCG-ZGh7zeDBWq3Qvwm3EeMLPzdklhrc';
const CACHE_SECONDS = 60;

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'trackSlackBrowserClick') {
    trackSlackBrowserClick();
    return json({ ok: true });
  }
  if (action === 'getMenu') {
    return json(getMenu());
  }
  return json({ service: 'strata-portal-membership' });
}

function doPost(e) {
  let token = null;
  try {
    token = JSON.parse(e.postData.contents).token;
  } catch (err) {
    return json({ member: false, error: 'bad_request' });
  }
  return json(checkMember(token));
}

function checkMember(token) {
  if (!token) return { member: false, error: 'missing_token' };

  // tokeninfo verifies the signature and expiry; we still check it was issued for this portal.
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return { member: false, error: 'invalid_token' };

  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) return { member: false, error: 'wrong_audience' };
  if (String(info.email_verified) !== 'true') return { member: false, error: 'unverified_email' };

  const email = String(info.email).toLowerCase();
  return { member: memberEmails().indexOf(email) !== -1, email: email };
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

  cache.put('members', JSON.stringify(emails), CACHE_SECONDS);
  return emails;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// --- Dynamic menu, driven by the "Portal Menu" Sheet ---
// Matt maintains this sheet directly: one row per nav tab, columns
// Menu Name | Link | Type | Click Count. Row order = tab order. The `Type`
// column is informational only, not load-bearing - the actual embed
// behaviour is worked out from the shape of the Link URL itself, so a
// mismatched Type (e.g. a spreadsheet link marked "Doc") still renders
// correctly. A Doc or Sheet link gets embedded inline with an "open to
// edit" link, same pattern as the portal's hardcoded tabs always used; a
// Drive folder link embeds the folder view; anything else (a workspace
// app link, a custom URL scheme like slack://) is treated as a plain
// external link.

function getMenu() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('menu');
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.openById(MENU_SHEET_ID);
  const rows = getMenuTableRows(ss);

  const items = rows
    .filter(function (r) { return String(r[0] || '').trim(); })
    .map(function (r) {
      const name = String(r[0] || '').trim();
      const link = String(r[1] || '').trim();
      return { name: name, link: link, kind: classifyLink(link), id: extractId(link) };
    });

  // Portal title, from a named range in the same sheet rather than a fixed
  // header row/column - keeps it independent of however the menu table
  // itself gets edited. Falls back to '' (frontend keeps its config.js
  // default) if the named range is missing or empty.
  let portalName = '';
  try {
    const range = ss.getRangeByName('PortalName');
    portalName = range ? String(range.getValue()).trim() : '';
  } catch (err) {
    portalName = '';
  }

  const result = { portalName: portalName, items: items };
  cache.put('menu', JSON.stringify(result), CACHE_SECONDS);
  return result;
}

const MENU_TABLE_NAME = 'Menu';

// SpreadsheetApp (the built-in service) has no API for Sheets' native
// Table objects - confirmed via a live test, sheet.getTables() doesn't
// exist there. The Advanced Sheets Service (added via Services + in the
// editor, identifier "Sheets") does expose them, via the REST API's
// `tables` field on each sheet. This looks up the table by name, reads
// its *current* range (which tracks the table as it grows - no manual
// resizing needed, unlike a named range), then pulls the actual cell
// values through SpreadsheetApp using that range.
function getMenuTableRows(ss) {
  const meta = Sheets.Spreadsheets.get(ss.getId(), {
    fields: 'sheets(properties(sheetId),tables(name,range))',
  });

  let table = null;
  let sheetId = null;
  (meta.sheets || []).forEach(function (sheet) {
    (sheet.tables || []).forEach(function (t) {
      if (t.name === MENU_TABLE_NAME) {
        table = t;
        sheetId = sheet.properties.sheetId;
      }
    });
  });
  if (!table) throw new Error('Table "' + MENU_TABLE_NAME + '" not found');

  const gridSheet = ss.getSheets().filter(function (s) {
    return s.getSheetId() === sheetId;
  })[0];

  const r = table.range;
  const numRows = r.endRowIndex - r.startRowIndex;
  const numCols = r.endColumnIndex - r.startColumnIndex;
  const values = gridSheet
    .getRange(r.startRowIndex + 1, r.startColumnIndex + 1, numRows, numCols)
    .getValues();

  // The table always has exactly one header row (row 0 of its own range,
  // confirmed - Home/To-Do List/etc are rows 1-7) - so just drop it.
  return values.slice(1).filter(function (row) {
    return String(row[0] || '').trim();
  });
}

function classifyLink(link) {
  if (!link) return 'empty';
  // Drive folder URLs sometimes carry a /u/<n>/ account-switcher segment
  // (e.g. drive.google.com/drive/u/3/folders/...) depending on how the
  // link was copied, so match on "/folders/" rather than a fixed prefix.
  if (/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//.test(link)) return 'folder';
  if (link.indexOf('docs.google.com/document/') !== -1) return 'doc';
  if (link.indexOf('docs.google.com/spreadsheets/') !== -1) return 'sheet';
  return 'link';
}

function extractId(link) {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Run this once from the editor to sanity-check the menu sheet is readable
// and see how each row was classified, before wiring it up live.
function testGetMenu() {
  Logger.log(JSON.stringify(getMenu(), null, 2));
}

// --- Slack Browser link click tracking ---
// Purely to gauge whether anyone actually uses the "Slack Browser" fallback
// link (as opposed to "Slack App"), so Matt can decide whether to remove it
// later. Not shown anywhere in the portal itself, only in the weekly email
// below. Counters live in PropertiesService rather than CacheService since
// they need to persist indefinitely, not just for a few hours.

function trackSlackBrowserClick() {
  const props = PropertiesService.getScriptProperties();
  const weekly = Number(props.getProperty('slackBrowserClicksWeekly') || '0') + 1;
  const total = Number(props.getProperty('slackBrowserClicksTotal') || '0') + 1;
  props.setProperty('slackBrowserClicksWeekly', String(weekly));
  props.setProperty('slackBrowserClicksTotal', String(total));
}

// Emails Matt this week's and the all-time Slack Browser click count, then
// resets the weekly counter to 0. Runs from the time-driven trigger created
// by setupWeeklyTrigger() below, not from the web app itself.
function sendWeeklySlackClickReport() {
  const props = PropertiesService.getScriptProperties();
  const weekly = props.getProperty('slackBrowserClicksWeekly') || '0';
  const total = props.getProperty('slackBrowserClicksTotal') || '0';

  MailApp.sendEmail({
    to: 'matthew.j.allington@gmail.com',
    subject: 'Strata portal: Slack Browser link clicks this week',
    body:
      'Slack Browser link clicks this week: ' + weekly + '\n' +
      'Total clicks since tracking started: ' + total,
  });

  props.setProperty('slackBrowserClicksWeekly', '0');
}

// Run this once from the editor (select it in the function dropdown, then
// the Run button) to schedule the weekly email - it only needs doing once,
// ever. Check Triggers (the clock icon, left sidebar) first if unsure
// whether it's already set up: running this twice creates two triggers and
// two emails every week.
function setupWeeklyTrigger() {
  ScriptApp.newTrigger('sendWeeklySlackClickReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
}

// Run this once from the editor to grant permissions and see who currently counts as a member.
function testListMembers() {
  Logger.log(memberEmails());
}
