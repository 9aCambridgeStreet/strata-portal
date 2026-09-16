// Membership check for the strata portal. Deployed as a web app under the
// committee's secretary account (execute as: me, access: anyone).
// A person is a member if the Strata Committee Documents folder is shared with them.

const CLIENT_ID = '983495642617-v0a00ou5rj018d2vjp0veqq0kjuk29je.apps.googleusercontent.com';
const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const CACHE_SECONDS = 60;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'trackSlackBrowserClick') {
    trackSlackBrowserClick();
    return json({ ok: true });
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
