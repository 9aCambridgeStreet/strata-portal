// Finds any file or folder inside Strata Committee Documents that isn't
// owned by the secretary account, and emails the secretary a link to fix
// each one. Deployed as a web app under the secretary account (execute as:
// me), same reasoning as Code.gs: a departed committee member keeps
// ownership of anything they uploaded even after their Drive access is
// removed, and if they ever close their Google account those files vanish
// from the folder with no warning. See "Ownership Audit" in the README.

const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const SECRETARY_EMAIL = 'secretary.9a.cambridge.st@gmail.com';

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

// Emails the secretary account only when something is actually found, so
// this stays silent day to day and only lands in the inbox when it matters.
function checkOwnership() {
  const items = auditFolderTree();
  if (!items.length) return;

  const scriptUrl = ScriptApp.getService().getUrl();
  const blocks = items.map(function (item) {
    const header = (item.type === 'folder' ? '[FOLDER] ' : '') + item.name;
    const action = item.type === 'file'
      ? '  Make a secretary-owned copy: ' + scriptUrl + '?action=copyFile&fileId=' + encodeURIComponent(item.id) + '\n'
      : '  (a folder - this can\'t copy a whole folder tree in one step; move or recreate its contents manually if needed)\n';
    return (
      header + '\n' +
      '  Location: ' + item.path + '\n' +
      '  Owned by: ' + item.owner + '\n' +
      '  Open: ' + item.url + '\n' +
      action
    );
  });

  MailApp.sendEmail({
    to: SECRETARY_EMAIL,
    subject: 'Strata portal: ' + items.length + ' item(s) in Committee Documents not owned by the secretary',
    body:
      'The items below, inside Strata Committee Documents, are owned by someone other ' +
      'than the secretary account. If any of those people ever lose or close their Google ' +
      'account, their files disappear from this folder with no warning, and until then they ' +
      'personally retain the power to delete or reshare them regardless of what the committee ' +
      'wants.\n\n' +
      'For a file, click "Make a secretary-owned copy" below to create a copy owned by the ' +
      'secretary account, in the same folder. The original is left alone - decide separately ' +
      'whether to delete it, and whether anything (like js/config.js in the portal) points at ' +
      'its file ID, since the copy gets a new one.\n\n' +
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

  const parents = file.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);
  const copy = file.makeCopy(file.getName() + ' (secretary copy)', parentFolder);

  return page(
    '<p>Made a secretary-owned copy of “' + file.getName() + '”.</p>' +
    '<p><a href="' + copy.getUrl() + '" target="_blank">Open the new copy</a></p>' +
    '<p>The original (still owned by ' + ownerEmail + ') has been left alone. Decide whether to ' +
    'delete it, and whether anything elsewhere points at its file ID, since the copy has a new one.</p>'
  );
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
