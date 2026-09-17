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

// Hardcoded rather than read via ScriptApp.getService().getUrl(), because
// that call returns a "/dev" test URL (usable only by accounts with edit
// access to this script project) rather than the real "/exec" deployment
// URL when checkOwnership runs from the editor's Run button - and possibly
// also from a time-driven trigger, not just manual runs. A "/dev" link in
// the audit email would leave anyone in ExtraAdminEmails unable to open it.
// Same pattern as membershipUrl in js/config.js: update this if the
// deployment is ever recreated from scratch rather than redeployed as a
// new version of the existing one (which keeps this URL unchanged).
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwvJtpsKsiIf3yisb3q-grm-jaLsfKsGi3oWdfOW7-qLPyY1ARHKW3ccK46nl7c4BlS1Q/exec';

// Same Sheet Code.gs's getMenu() reads to build the live nav bar - one row
// per tab, Link column points at the Drive file it embeds. Read directly
// here (rather than js/config.js, which still has four old file-ID fields
// nothing actually reads any more - loadMenu() in js/app.js builds the nav
// entirely from this Sheet now) so this always reflects what's actually
// live, not a hand-maintained snapshot that can drift. Referenced by ID
// only, so renaming the Sheet itself (it started as "Portal Menu", now also
// holds the ExtraAdminEmails table below) never needs a code change here.
const MENU_SHEET_ID = '1RnmCjsRmNsnVCG-ZGh7zeDBWq3Qvwm3EeMLPzdklhrc';
const MENU_TABLE_NAME = 'Menu';

// A Table in the same Sheet, one column of email addresses (header row
// aside), that a layperson can edit with zero code to change who gets the
// ownership-audit email, beyond the secretary account, which always gets
// it regardless of this list. Replaces the old notifyEmails Script
// Property entirely, so there's one place to manage this, not two.
const EXTRA_ADMIN_TABLE_NAME = 'ExtraAdminEmails';

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
    const rows = getNamedTableRows(ss, MENU_TABLE_NAME);
    const ids = {};
    rows.forEach(function (r) {
      const name = String(r[0] || '').trim();
      const id = extractMenuLinkId(String(r[1] || '').trim());
      if (id) ids[id] = name;
    });
    return { ok: true, ids: ids };
  } catch (err) {
    Logger.log('getMenuLinkedFileIds failed: ' + err + (err.stack ? '\n' + err.stack : ''));
    return { ok: false, ids: {} };
  }
}

// Same Table-lookup approach as Code.gs's getMenuTableRows() (there hardcoded
// to the Menu table, duplicated rather than called over HTTP so this audit
// doesn't depend on the Membership web app's deployment being up or its URL
// never changing), generalized here to take any table name so this one
// function also serves getExtraAdminEmails() below.
function getNamedTableRows(ss, tableName) {
  const meta = Sheets.Spreadsheets.get(ss.getId(), {
    fields: 'sheets(properties(sheetId),tables(name,range))',
  });

  let table = null;
  let sheetId = null;
  (meta.sheets || []).forEach(function (sheet) {
    (sheet.tables || []).forEach(function (t) {
      if (t.name === tableName) {
        table = t;
        sheetId = sheet.properties.sheetId;
      }
    });
  });
  if (!table) throw new Error('Table "' + tableName + '" not found');

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

// Who gets the audit email: the secretary account always, plus whoever is
// listed in the ExtraAdminEmails table (one column, header row aside) in
// the same Sheet as the portal menu - a layperson can add or remove people
// there with no code and no redeploy. Falls back to secretary-only if that
// table can't be read, same fail-safe reasoning as getMenuLinkedFileIds.
function getNotifyEmails() {
  const extras = getExtraAdminEmails();
  const seen = {};
  return [SECRETARY_EMAIL].concat(extras).filter(function (e) {
    if (seen[e]) return false;
    seen[e] = true;
    return true;
  });
}

function getExtraAdminEmails() {
  try {
    const ss = SpreadsheetApp.openById(MENU_SHEET_ID);
    const rows = getNamedTableRows(ss, EXTRA_ADMIN_TABLE_NAME);
    return rows
      .map(function (r) { return String(r[0] || '').trim().toLowerCase(); })
      .filter(Boolean);
  } catch (err) {
    Logger.log('getExtraAdminEmails failed: ' + err + (err.stack ? '\n' + err.stack : ''));
    return [];
  }
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

  // Files first, then folders, always - regardless of nesting. The tree
  // walk above naturally interleaves a folder with its own children, but
  // Matt wants every file actioned before any folder gets touched, so this
  // reorders (a stable partition, not a re-sort - order within each group
  // is unchanged) before numbering and building the email.
  const orderedItems = items.filter(function (i) { return i.type === 'file'; })
    .concat(items.filter(function (i) { return i.type === 'folder'; }));

  const menu = getMenuLinkedFileIds();
  const scriptUrl = WEB_APP_URL;
  let fileNumber = 0;
  let folderNumber = 0;
  const blocks = orderedItems.map(function (item) {
    const name = escapeHtml(item.name);
    const path = escapeHtml(item.path);
    const owner = escapeHtml(item.owner);

    if (item.type === 'folder') {
      folderNumber++;
      const number = folderNumber;
      const fixUrl = scriptUrl + '?action=fixFolder&folderId=' + encodeURIComponent(item.id);
      return (
        '<p><b>Folder ' + number + ': ' + name + '</b><br>' +
        'Location: ' + path + '<br>' +
        'Currently owned by: ' + owner + '<br>' +
        '<a href="' + fixUrl + '">Click here to fix this folder</a><br>' +
        'Clicking this link renames the old folder to &ldquo;' + name + ' - old&rdquo; and creates ' +
        'a new folder called &ldquo;' + name + '&rdquo; owned by the secretary account. You then ' +
        'need to manually move any files from the old folder into the new one, then manually ' +
        'delete the old folder. Any moved files still owned by another committee member will show ' +
        'up in a future audit, so don’t worry about ownership of those files for now.</p>'
      );
    }

    fileNumber++;
    const number = fileNumber;
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

  // Anyone on the notify list can click this link, and someone else may
  // already have. If the original's already trashed, a previous click
  // already fully processed it (the not-linked, auto-trash path). Report
  // that plainly instead of quietly making a second, redundant copy.
  if (file.isTrashed()) {
    return page('<p>“' + file.getName() + '” has already been actioned, someone already made a ' +
      'secretary-owned copy and trashed this original. Nothing more to do here.</p>');
  }

  const originalId = file.getId();
  const originalName = file.getName();
  const parents = file.getParents();
  let parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);

  // If this file's current folder is itself a renamed "X - old" folder from
  // an earlier folder fix, redirect the copy straight into the "X" folder
  // created alongside it, rather than back into "X - old" - otherwise a
  // file fixed after its folder just needs yet another manual move.
  const parentName = parentFolder.getName();
  if (/ - old$/.test(parentName)) {
    const grandparents = parentFolder.getParents();
    if (grandparents.hasNext()) {
      const cleanParentName = parentName.replace(/ - old$/, '');
      const siblingFolders = grandparents.next().getFoldersByName(cleanParentName);
      if (siblingFolders.hasNext()) {
        const candidate = siblingFolders.next();
        const candidateOwner = candidate.getOwner();
        if (candidateOwner && candidateOwner.getEmail().toLowerCase() === SECRETARY_EMAIL) {
          parentFolder = candidate;
        }
      }
    }
  }

  // The original is deliberately left untrashed when it's menu-linked (or
  // the menu couldn't be checked), so isTrashed() alone can't catch a
  // repeat click in that case - check for an already-made secretary-owned
  // copy sitting alongside it instead.
  const siblings = parentFolder.getFilesByName(originalName);
  while (siblings.hasNext()) {
    const sibling = siblings.next();
    if (sibling.getId() === originalId) continue;
    const siblingOwner = sibling.getOwner();
    if (siblingOwner && siblingOwner.getEmail().toLowerCase() === SECRETARY_EMAIL) {
      return page('<p>A secretary-owned copy of “' + originalName + '” already exists, someone ' +
        'else already actioned this.</p>' +
        '<p><a href="' + sibling.getUrl() + '" target="_blank">Open the existing copy</a></p>' +
        '<p>Nothing more to do here - if this original hasn’t been swapped out and trashed yet, ' +
        'finish that manually.</p>');
    }
  }

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
    // DriveApp.setTrashed() has a known, more conservative internal check
    // than the real Drive API for files the caller doesn't own - confirmed
    // live: getAccess() reported EDIT for the secretary account, which
    // should be plenty to trash a file, yet DriveApp still refused with
    // "Access denied". Calling the Advanced Drive Service directly instead
    // (the same underlying API the Drive web UI itself uses, where trashing
    // an Edit-access file someone else owns works fine) avoids that.
    let trashError = null;
    try {
      Drive.Files.update({ trashed: true }, originalId);
    } catch (err) {
      trashError = err.message;
    }
    if (trashError) {
      let secretaryAccess;
      try {
        secretaryAccess = file.getAccess(SECRETARY_EMAIL).toString();
      } catch (accessErr) {
        secretaryAccess = 'unknown';
      }
      html += '<p><strong>Could not trash the original</strong> (still owned by ' + ownerEmail +
        '): ' + trashError + ' (secretary account access: ' + secretaryAccess + '). Move it to ' +
        'Trash yourself in Drive so there aren’t two live copies.</p>';
    } else {
      html += '<p>The original (previously owned by ' + ownerEmail + ') has been moved to Trash, ' +
        'so only the new copy is visible in the folder now. It’s recoverable from Drive’s Trash ' +
        'for about 30 days if that turns out to be wrong.</p>';
    }
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

  // Anyone on the notify list can click this link, and someone else may
  // already have. This link always targets the same folder ID, and a
  // previous click renames it in place (see below), so a repeat click sees
  // its own earlier "- old" rename rather than a fresh, unactioned folder.
  const currentName = folder.getName();
  if (/ - old$/.test(currentName)) {
    const cleanName = currentName.replace(/ - old$/, '');
    return page('<p>This folder has already been actioned, someone already renamed it to “' +
      currentName + '” and created a new “' + cleanName + '” folder alongside it.</p>' +
      '<p>Nothing more to do here - if the contents haven’t been moved across and this old ' +
      'folder deleted yet, finish that manually.</p>');
  }

  const originalName = folder.getName();
  const parents = folder.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);

  folder.setName(originalName + ' - old');
  const newFolder = parentFolder.createFolder(originalName);

  // If a file or subfolder inside was fixed via its own "take ownership"
  // link before this folder was fixed, it's already secretary-owned and can
  // just be moved straight into the new folder - no need to leave that for
  // a manual step too. Only items still owned by someone else are left
  // behind in the renamed old folder, since those still need their own fix.
  const movedNames = [];
  const remainingFiles = folder.getFiles();
  while (remainingFiles.hasNext()) {
    const f = remainingFiles.next();
    const fOwner = f.getOwner();
    if (fOwner && fOwner.getEmail().toLowerCase() === SECRETARY_EMAIL) {
      f.moveTo(newFolder);
      movedNames.push(f.getName());
    }
  }
  const remainingFolders = folder.getFolders();
  while (remainingFolders.hasNext()) {
    const sub = remainingFolders.next();
    const subOwner = sub.getOwner();
    if (subOwner && subOwner.getEmail().toLowerCase() === SECRETARY_EMAIL) {
      sub.moveTo(newFolder);
      movedNames.push(sub.getName());
    }
  }

  const stillInOld = folder.getFiles().hasNext() || folder.getFolders().hasNext();

  let html =
    '<p>Renamed the old folder to “' + originalName + ' - old” and created a new folder called “' +
    originalName + '”, owned by the secretary account.</p>' +
    '<p><a href="' + newFolder.getUrl() + '" target="_blank">Open the new folder</a></p>';

  if (movedNames.length) {
    html += '<p>Already secretary-owned, so moved straight across: ' +
      movedNames.map(escapeHtml).join(', ') + '.</p>';
  }

  html += stillInOld
    ? '<p><strong>Next steps:</strong> everything remaining in “' + originalName +
      ' - old” is still owned by someone else. Fix each of those individually (their own audit ' +
      'entries have their own links), they’ll land straight in the new folder the same way once ' +
      'fixed. Once “' + originalName + ' - old” is empty, delete it.</p>'
    : '<p>“' + originalName + ' - old” is now empty, safe to delete.</p>';

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
