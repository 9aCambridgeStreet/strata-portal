// Finds any file or folder inside Strata Committee Documents that isn't
// owned by the secretary account, and emails a link to fix each one.
// Deployed as a web app under the secretary account (execute as: me), same
// reasoning as Code.gs: a departed committee member keeps ownership of
// anything they uploaded even after their Drive access is removed, and if
// they ever close their Google account those files vanish from the folder
// with no warning. Fixing a file makes a secretary-owned copy AND trashes
// the original in the same step, so the folder never shows two live copies
// of the same document. See "Ownership Audit" in the README.

const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const SECRETARY_EMAIL = 'secretary.9a.cambridge.st@gmail.com';
const DEFAULT_NOTIFY_EMAILS = [SECRETARY_EMAIL, 'matthew.j.allington@gmail.com'];

// File IDs the portal itself hardcodes in js/config.js, keyed to the config
// key that names them. Copying one of these and trashing the original still
// leaves the portal pointing at the now-trashed original's ID, so the copy
// action calls this out explicitly rather than leaving it to be discovered
// as a broken embed. Keep this in sync by hand if js/config.js ever changes
// which IDs it hardcodes, there's no live link between the two files.
const PORTAL_CONFIG_FILE_IDS = {
  '1c25axkB_KaTPaZXksvpXh1FFL-BCOhj-NNyD7vOuOIc': 'portalHomeDocId',
  '12IZwt4u3C9uHAdsAnkthy5rnqwIgLxQNzdlP3-ZI85Q': 'agreedProcessesDocId',
  '1ZmX6EnsJ20UTBMGt0f3e0772mWwFO7T6UHVLqsuqUCk': 'budgetSheetId',
  '1Knvz5_q8ImCxUp-CVDUJo5-7bnvOBwMhUSnzttE_bvo': 'sheetId',
};

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'copyFile') {
    return copyFileAction(e.parameter.fileId);
  }
  return page('<p>Strata ownership audit. Nothing to see here directly, ' +
    'this runs on a schedule and emails the secretary account.</p>');
}

// --- The audit itself ---

function auditFolderTree() {
  const items = [];
  const root = DriveApp.getFolderById(FOLDER_ID);
  checkOwner(root, 'Strata Committee Documents', 'folder', items);
  walkChildren(root, 'Strata Committee Documents', items);
  return items;
}

function walkChildren(folder, path, items) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    checkOwner(files.next(), path, 'file', items);
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    const subPath = path + ' / ' + sub.getName();
    checkOwner(sub, subPath, 'folder', items);
    walkChildren(sub, subPath, items);
  }
}

function checkOwner(item, path, type, items) {
  const owner = item.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : null;
  if (ownerEmail === SECRETARY_EMAIL) return;
  items.push({
    id: item.getId(),
    name: item.getName(),
    path: path,
    owner: ownerEmail || '(unknown - Drive did not report an owner)',
    url: item.getUrl(),
    type: type,
  });
}

// Who gets the audit email. Stored in Script Properties rather than
// hardcoded, same pattern as setAlertEmails() in the "Strata Auto Backup"
// script, so the recipient list can change without touching or redeploying
// this file. Falls back to DEFAULT_NOTIFY_EMAILS until setNotifyEmails() is
// ever run.
function getNotifyEmails() {
  const stored = PropertiesService.getScriptProperties().getProperty('notifyEmails');
  if (!stored) return DEFAULT_NOTIFY_EMAILS;
  return stored.split(',').map(function (e) { return e.trim(); }).filter(Boolean);
}

// Run this once from the editor (edit the string first) to change who gets
// the audit email - takes effect immediately, no redeploy needed.
// e.g. setNotifyEmails('secretary.9a.cambridge.st@gmail.com, someone@else.com')
function setNotifyEmails(commaSeparatedList) {
  PropertiesService.getScriptProperties().setProperty('notifyEmails', commaSeparatedList);
}

// Run this from the editor to see the current recipient list in the log.
function testGetNotifyEmails() {
  Logger.log(getNotifyEmails());
}

// Emails the current notify list only when something is actually found, so
// this stays silent day to day and only lands in the inbox when it matters.
function checkOwnership() {
  const items = auditFolderTree();
  if (!items.length) return;

  const scriptUrl = ScriptApp.getService().getUrl();
  const blocks = items.map(function (item) {
    const header = (item.type === 'folder' ? '[FOLDER] ' : '') + item.name;
    const configKey = PORTAL_CONFIG_FILE_IDS[item.id];
    let action;
    if (item.type !== 'file') {
      action = '  (a folder - this can\'t copy a whole folder tree in one step; move or recreate its contents manually if needed)\n';
    } else {
      action = '  Make a secretary-owned copy (trashes the original): ' +
        scriptUrl + '?action=copyFile&fileId=' + encodeURIComponent(item.id) + '\n';
      if (configKey) {
        action += '  NOTE: hardcoded in js/config.js as ' + configKey + ' - you\'ll need to update ' +
          'that to the new copy\'s ID afterward, the link will tell you the new ID.\n';
      }
    }
    return (
      header + '\n' +
      '  Location: ' + item.path + '\n' +
      '  Owned by: ' + item.owner + '\n' +
      '  Open: ' + item.url + '\n' +
      action
    );
  });

  MailApp.sendEmail({
    to: getNotifyEmails().join(','),
    subject: 'Strata portal: ' + items.length + ' item(s) in Committee Documents not owned by the secretary',
    body:
      'The items below, inside Strata Committee Documents, are owned by someone other ' +
      'than the secretary account. If any of those people ever lose or close their Google ' +
      'account, their files disappear from this folder with no warning, and until then they ' +
      'personally retain the power to delete or reshare them regardless of what the committee ' +
      'wants.\n\n' +
      'For a file, click "Make a secretary-owned copy" below to create a copy owned by the ' +
      'secretary account in the same folder, and move the original to Drive\'s Trash (recoverable ' +
      'for about 30 days) so there\'s never two live copies of the same document sitting there at ' +
      'once.\n\n' +
      blocks.join('\n'),
  });
}

// --- The one-click fix ---

function copyFileAction(fileId) {
  if (!fileId) return page('<p>Missing file ID.</p>');

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return page('<p>Could not open that file. It may have been moved or deleted, or the link is wrong.</p>');
  }

  if (!isFileInAuditScope(file)) {
    return page('<p>That file is not inside the Strata Committee Documents folder, so this tool won’t touch it.</p>');
  }

  const owner = file.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : null;
  if (ownerEmail === SECRETARY_EMAIL) {
    return page('<p>“' + file.getName() + '” is already owned by the secretary account. Nothing to do.</p>');
  }

  const originalId = file.getId();
  const originalName = file.getName();
  const parents = file.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);
  const copy = file.makeCopy(originalName, parentFolder);

  // Trash (not permanently delete) the original straight after copying, so
  // the folder never shows two live copies of the same document at once -
  // that ambiguity about which one to edit is worse than the ownership
  // problem itself. Trashing is reversible from Drive's own Trash for the
  // usual ~30 days, unlike a hard delete.
  let trashError = null;
  try {
    file.setTrashed(true);
  } catch (err) {
    trashError = err.message;
  }

  const configKey = PORTAL_CONFIG_FILE_IDS[originalId];
  let html =
    '<p>Made a secretary-owned copy of “' + originalName + '”.</p>' +
    '<p><a href="' + copy.getUrl() + '" target="_blank">Open the new copy</a></p>';

  html += trashError
    ? '<p><strong>Could not trash the original</strong> (still owned by ' + ownerEmail + '): ' +
      trashError + '. Move it to Trash yourself in Drive so there aren’t two live copies.</p>'
    : '<p>The original (previously owned by ' + ownerEmail + ') has been moved to Trash, so only ' +
      'the new copy is visible in the folder now. It’s recoverable from Drive’s Trash for about ' +
      '30 days if that turns out to be wrong.</p>';

  if (configKey) {
    html +=
      '<p><strong>Action needed:</strong> this file’s old ID is hardcoded in js/config.js as ' +
      '<code>' + configKey + '</code>. The portal is now pointing at a trashed file until you update ' +
      '<code>' + configKey + '</code> to the copy’s new ID:</p>' +
      '<p><code>' + copy.getId() + '</code></p>';
  }

  return page(html);
}

// Confirms fileId is actually somewhere under FOLDER_ID before this script
// will touch it, walking every parent chain (a file can technically have
// more than one) rather than trusting the caller. `seen` guards against a
// cycle, which shouldn't happen in real Drive data but costs nothing to
// rule out.
function isFileInAuditScope(file) {
  const seen = {};
  let queue = [];
  const parents = file.getParents();
  while (parents.hasNext()) queue.push(parents.next());

  let depth = 0;
  while (queue.length && depth < 30) {
    const next = [];
    for (let i = 0; i < queue.length; i++) {
      const folder = queue[i];
      if (folder.getId() === FOLDER_ID) return true;
      if (seen[folder.getId()]) continue;
      seen[folder.getId()] = true;
      const ps = folder.getParents();
      while (ps.hasNext()) next.push(ps.next());
    }
    queue = next;
    depth++;
  }
  return false;
}

function page(bodyHtml) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;max-width:480px;">' + bodyHtml + '</div>'
  );
}

// Run this once from the editor to schedule the daily check. Check
// Triggers (the clock icon, left sidebar) first if unsure whether it's
// already set up - running this twice creates two triggers and two emails
// on any day something is found.
function setupDailyOwnershipCheck() {
  ScriptApp.newTrigger('checkOwnership')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

// Run this from the editor to see the current findings in the log without
// waiting for the daily trigger or sending an email.
function testAuditFolderTree() {
  Logger.log(JSON.stringify(auditFolderTree(), null, 2));
}
