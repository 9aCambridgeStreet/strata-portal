// Finds any file or folder inside Strata Committee Documents that isn't
// owned by the secretary account, and emails a link to fix each one.
// Deployed as a web app under the secretary account (execute as: me), same
// reasoning as Code.gs: a departed committee member keeps ownership of
// anything they uploaded even after their Drive access is removed, and if
// they ever close their Google account those files vanish from the folder
// with no warning. Fixing a file makes a secretary-owned copy AND trashes
// the original in the same step, so the folder never shows two live copies
// of the same document - UNLESS that file is currently linked from the
// live Portal Menu Sheet (checked directly, see getMenuLinkedFileIds), in
// which case trashing it would break that nav tab, so the original is left
// alone for a manual swap instead. See "Ownership Audit" in the README.

const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const SECRETARY_EMAIL = 'secretary.9a.cambridge.st@gmail.com';
const DEFAULT_NOTIFY_EMAILS = [SECRETARY_EMAIL];

// Same "Portal Menu" Sheet Code.gs's getMenu() reads to build the live nav
// bar - one row per tab, Link column points at the Drive file it embeds.
// Read directly here (rather than js/config.js, which still has four old
// file-ID fields nothing actually reads any more - loadMenu() in js/app.js
// builds the nav entirely from this Sheet now) so this always reflects
// what's actually live, not a hand-maintained snapshot that can drift.
const MENU_SHEET_ID = '1RnmCjsRmNsnVCG-ZGh7zeDBWq3Qvwm3EeMLPzdklhrc';
const MENU_TABLE_NAME = 'Menu';

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'copyFile') {
    return copyFileAction(e.parameter.fileId);
  }
  if (action === 'fixFolder') {
    return fixFolderAction(e.parameter.folderId);
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

// --- Checking what's linked from the live nav ---

// { ok: boolean, ids: { fileId: menuItemName } }. `ok` is false whenever
// the Sheet couldn't be read, so callers can fail SAFE (treat every file as
// possibly menu-linked, i.e. don't auto-trash anything) rather than
// silently losing this protection if the Sheet is ever renamed, its Table
// restructured, or Sheets is just having a bad moment.
function getMenuLinkedFileIds() {
  try {
    const ss = SpreadsheetApp.openById(MENU_SHEET_ID);
    const rows = getMenuTableRows(ss);
    const ids = {};
    rows.forEach(function (r) {
      const name = String(r[0] || '').trim();
      const id = extractMenuLinkId(String(r[1] || '').trim());
      if (id) ids[id] = name;
    });
    return { ok: true, ids: ids };
  } catch (err) {
    return { ok: false, ids: {} };
  }
}

// Same Table lookup as Code.gs's getMenuTableRows(), duplicated rather than
// called over HTTP so this audit doesn't depend on the Membership web app's
// deployment being up or its URL never changing.
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

  return values.slice(1).filter(function (row) {
    return String(row[0] || '').trim();
  });
}

function extractMenuLinkId(link) {
  if (!link) return null;
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Run this from the editor to see what the audit currently thinks is
// menu-linked, without waiting to hit it via a real file.
function testGetMenuLinkedFileIds() {
  Logger.log(JSON.stringify(getMenuLinkedFileIds(), null, 2));
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

  const menu = getMenuLinkedFileIds();
  const scriptUrl = ScriptApp.getService().getUrl();
  const blocks = items.map(function (item, i) {
    const number = i + 1;
    const name = escapeHtml(item.name);
    const path = escapeHtml(item.path);
    const owner = escapeHtml(item.owner);

    if (item.type === 'folder') {
      const fixUrl = scriptUrl + '?action=fixFolder&folderId=' + encodeURIComponent(item.id);
      return (
        '<p><b>Folder ' + number + ': ' + name + '</b><br>' +
        'Location: ' + path + '<br>' +
        'Currently owned by: ' + owner + '<br>' +
        '<a href="' + fixUrl + '">Click here to fix this folder</a><br>' +
        'This renames the old folder to &ldquo;' + name + ' - old&rdquo; and creates a new folder ' +
        'called &ldquo;' + name + '&rdquo; owned by the secretary account. Move any files from the ' +
        'old folder into the new one, then delete the old folder. Any moved files still owned by ' +
        'another committee member will show up in a future audit.</p>'
      );
    }

    const copyUrl = scriptUrl + '?action=copyFile&fileId=' + encodeURIComponent(item.id);
    const menuName = menu.ok ? menu.ids[item.id] : undefined;
    let note = '';
    if (!menu.ok) {
      note = 'Note: Couldn’t check the portal menu just now. If this file turns out to be ' +
        'linked there, copy the full path of the file and paste it in the file Portal\\Portal Menu ' +
        'after taking ownership.<br>';
    } else if (menuName) {
      note = 'Note: This file is linked in the portal menu. After taking ownership, copy the full ' +
        'path of the file and paste it in the file Portal\\Portal Menu so the menu continues to ' +
        'work.<br>';
    }

    return (
      '<p><b>File ' + number + ': ' + name + '</b><br>' +
      'Location: ' + path + '<br>' +
      'Currently owned by: ' + owner + '<br>' +
      '<a href="' + copyUrl + '">Click here to make a copy owned by the Secretary and delete the ' +
      'uploaded version</a><br>' +
      note + '</p>'
    );
  });

  const introHtml =
    '<p>This email is to advise you about any files loaded by a committee member into the ' +
    'portal. When a committee member loads a file, they retain ownership of that file. The ' +
    'files need to be owned by the secretary account, not the committee members. This email ' +
    'steps you through each of those files so that you can take ownership.</p>';

  MailApp.sendEmail({
    to: getNotifyEmails().join(','),
    subject: 'Strata portal: ' + items.length + ' item(s) in Committee Documents not owned by the secretary',
    htmlBody: introHtml + blocks.join(''),
  });
}

// Minimal HTML-escaping for values (file/folder names, folder paths) that
// come from Drive and could contain &, < or > - without this, a name like
// "A & B.pdf" would silently break the rest of that block's HTML.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  if (!isItemInAuditScope(file)) {
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

  let html =
    '<p>Made a secretary-owned copy of “' + originalName + '”.</p>' +
    '<p><a href="' + copy.getUrl() + '" target="_blank">Open the new copy</a></p>';

  // Check the live Portal Menu Sheet before trashing anything - trashing a
  // file that's currently a nav tab would break that tab's embed. Fail
  // SAFE if the Sheet can't be read: leave the original alone rather than
  // risk trashing something that's actually still live in the menu.
  const menu = getMenuLinkedFileIds();
  const menuName = menu.ok ? menu.ids[originalId] : undefined;

  if (!menu.ok) {
    html += '<p><strong>Could not check the Portal Menu Sheet just now</strong>, so the original ' +
      'has been left alone rather than risk trashing something still linked from the nav. Check ' +
      'by hand, then trash it yourself in Drive once you’re sure it’s safe to.</p>';
  } else if (menuName) {
    html += '<p><strong>Action needed:</strong> this file is linked from the main menu as “' +
      menuName + '”, so the original has been left alone rather than trashed. Update that ' +
      'row’s Link in the Portal Menu Sheet to the new copy’s URL below, then trash the ' +
      'original yourself once that change is live:</p>' +
      '<p><code>' + copy.getUrl() + '</code></p>';
  } else {
    let trashError = null;
    try {
      file.setTrashed(true);
    } catch (err) {
      trashError = err.message;
    }
    html += trashError
      ? '<p><strong>Could not trash the original</strong> (still owned by ' + ownerEmail + '): ' +
        trashError + '. Move it to Trash yourself in Drive so there aren’t two live copies.</p>'
      : '<p>The original (previously owned by ' + ownerEmail + ') has been moved to Trash, so only ' +
        'the new copy is visible in the folder now. It’s recoverable from Drive’s Trash for ' +
        'about 30 days if that turns out to be wrong.</p>';
  }

  return page(html);
}

// --- The one-click folder fix ---

// A folder can't be copied in one Drive API call the way a file can (there's
// no "copy this whole tree" method), so instead of a copy this renames the
// wrongly-owned folder out of the way and creates a same-named replacement
// that's secretary-owned from birth (createFolder() always makes the new
// folder owned by whoever the script is running as). The person actioning
// the email still has to manually move the contents across and delete the
// old folder - there's no way to reassign ownership of existing files in
// bulk via the Drive API, only ever create new secretary-owned ones.
function fixFolderAction(folderId) {
  if (!folderId) return page('<p>Missing folder ID.</p>');

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    return page('<p>Could not open that folder. It may have been moved or deleted, or the link is wrong.</p>');
  }

  if (!isItemInAuditScope(folder)) {
    return page('<p>That folder is not inside the Strata Committee Documents folder, so this tool won’t touch it.</p>');
  }

  const owner = folder.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : null;
  if (ownerEmail === SECRETARY_EMAIL) {
    return page('<p>“' + folder.getName() + '” is already owned by the secretary account. Nothing to do.</p>');
  }

  const originalName = folder.getName();
  const parents = folder.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);

  folder.setName(originalName + ' - old');
  const newFolder = parentFolder.createFolder(originalName);

  const html =
    '<p>Renamed the old folder to “' + originalName + ' - old” and created a new folder called “' +
    originalName + '”, owned by the secretary account.</p>' +
    '<p><a href="' + newFolder.getUrl() + '" target="_blank">Open the new folder</a></p>' +
    '<p><strong>Next steps:</strong> move every file and subfolder from “' + originalName +
    ' - old” into this new folder, then delete “' + originalName + ' - old”. Any moved file still ' +
    'owned by someone other than the secretary account will show up in a future audit.</p>';

  return page(html);
}

// Confirms a file or folder is actually somewhere under FOLDER_ID before
// this script will touch it, walking every parent chain (an item can
// technically have more than one) rather than trusting the caller. `seen`
// guards against a cycle, which shouldn't happen in real Drive data but
// costs nothing to rule out.
function isItemInAuditScope(item) {
  const seen = {};
  let queue = [];
  const parents = item.getParents();
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
