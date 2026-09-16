// Membership check for the strata portal. Deployed as a web app under the
// committee's secretary account (execute as: me, access: anyone).
// A person is a member if the Strata Committee Documents folder is shared with them.

const CLIENT_ID = '983495642617-v0a00ou5rj018d2vjp0veqq0kjuk29je.apps.googleusercontent.com';
const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const CACHE_SECONDS = 60;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'count') {
    return json({ count: documentsFileCount() });
  }
  return json({ service: 'strata-portal-membership' });
}

// Number of files directly inside the Documents folder (not counting
// subfolders like Planning/Processes, or files inside them), for the
// Documents tab's toolbar. Cached alongside the membership list.
function documentsFileCount() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('fileCount');
  if (cached !== null) return Number(cached);

  const files = DriveApp.getFolderById(FOLDER_ID).getFiles();
  let count = 0;
  while (files.hasNext()) {
    files.next();
    count++;
  }

  cache.put('fileCount', String(count), CACHE_SECONDS);
  return count;
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

// Run this once from the editor to grant permissions and see who currently counts as a member.
function testListMembers() {
  Logger.log(memberEmails());
}
