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
  if (action === 'fixFiles') {
    return fixFilesAction(e.parameter.folderId);
  }
  return page('<p>Strata ownership audit. Nothing to see here directly, ' +
    'this runs on a schedule and emails the secretary account.</p>');
}

// --- The audit itself ---

function auditFolderTree() {
  const items = [];
  const root = DriveApp.getFolderById(FOLDER_ID);
  const rootItem = checkOwner(root, 'Strata Committee Documents', 'folder', items, null, null);
  walkChildren(root, 'Strata Committee Documents', items, rootItem);
  return items;
}

// `top` is the outermost wrongly-owned folder we're currently inside (or
// null). Anything found inside one is tagged coveredBy that folder, because
// fixing the folder fixes its whole contents in one go - the email only
// needs a link for the folder, not for each thing inside it.
function walkChildren(folder, path, items, top) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    checkOwner(files.next(), path, 'file', items, top, folder);
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const sub = subfolders.next();
    const subPath = path + ' / ' + sub.getName();
    const subItem = checkOwner(sub, subPath, 'folder', items, top, folder);
    walkChildren(sub, subPath, items, top || subItem);
  }
}

// Returns the entry it pushed, or null if the item is fine (or missing).
function checkOwner(item, path, type, items, top, parent) {
  // Drive's folder/file iterators are live queries, not a snapshot - if the
  // tree is actively being changed (e.g. a fix action moving files around)
  // at the exact moment this walk runs, next() can occasionally come back
  // empty. Skip it rather than crash the whole audit; anything genuinely
  // still wrong will show up again on the next run once things settle.
  if (!item) return null;
  const owner = item.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : null;
  if (ownerEmail === SECRETARY_EMAIL) return null;
  const entry = {
    id: item.getId(),
    name: item.getName(),
    path: path,
    owner: ownerEmail || '(unknown - Drive did not report an owner)',
    url: item.getUrl(),
    type: type,
    coveredBy: top ? top.id : null,
    parentId: parent ? parent.getId() : null,
  };
  items.push(entry);
  return entry;
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
//
// One link per wrongly-owned top-level folder (fixes the folder and
// everything inside it, subfolders included), then one link per ordinary
// folder holding loose wrongly-owned files (fixes those files together).
// Anything inside a wrongly-owned folder is covered by that folder's link,
// so it never gets a link of its own.
function checkOwnership() {
  const items = auditFolderTree();
  if (!items.length) return;

  const folders = items.filter(function (i) { return i.type === 'folder' && !i.coveredBy; });

  // Loose files, grouped by the folder they sit in (insertion order kept).
  const groups = [];
  const groupById = {};
  items.forEach(function (i) {
    if (i.type !== 'file' || i.coveredBy) return;
    if (!groupById[i.parentId]) {
      groupById[i.parentId] = { folderId: i.parentId, path: i.path, files: [] };
      groups.push(groupById[i.parentId]);
    }
    groupById[i.parentId].files.push(i);
  });

  const scriptUrl = WEB_APP_URL;
  let step = 0;

  const folderBlocks = folders.map(function (item) {
    step++;
    const inside = items.filter(function (i) { return i.coveredBy === item.id; });
    const fileCount = inside.filter(function (i) { return i.type === 'file'; }).length;
    const folderCount = inside.filter(function (i) { return i.type === 'folder'; }).length;
    const fixUrl = scriptUrl + '?action=fixFolder&folderId=' + encodeURIComponent(item.id);
    return (
      '<p><b>Step ' + step + ' &ndash; folder: ' + escapeHtml(item.name) + '</b><br>' +
      'Location: ' + escapeHtml(item.path) + '<br>' +
      'Currently owned by: ' + escapeHtml(item.owner) + '<br>' +
      'Also inside it needing the same fix: ' + fileCount + ' file(s), ' + folderCount + ' subfolder(s)<br>' +
      '<a href="' + fixUrl + '">One click: take ownership of this folder and everything inside it</a><br>' +
      'This makes a new secretary-owned folder with the same name, copies everything across ' +
      '(keeping the folder structure), and moves the old versions to Trash. The old folder is ' +
      'renamed &ldquo;' + escapeHtml(item.name) + ' - old&rdquo; until it is empty.</p>'
    );
  });

  const fileBlocks = groups.map(function (g) {
    step++;
    const menu = getMenuLinkedFileIds();
    const names = g.files.map(function (f) {
      const linked = menu.ok ? menu.ids[f.id] : undefined;
      return '<li>' + escapeHtml(f.name) + ' (owned by ' + escapeHtml(f.owner) + ')' +
        (linked ? ' &ndash; linked in the portal menu as &ldquo;' + escapeHtml(linked) + '&rdquo;' : '') +
        '</li>';
    }).join('');
    const fixUrl = scriptUrl + '?action=fixFiles&folderId=' + encodeURIComponent(g.folderId);
    return (
      '<p><b>Step ' + step + ' &ndash; ' + g.files.length + ' file(s) in: ' + escapeHtml(g.path) + '</b><br>' +
      '<ul>' + names + '</ul>' +
      '<a href="' + fixUrl + '">One click: take ownership of these ' + g.files.length + ' file(s)</a></p>'
    );
  });

  const introHtml =
    '<p>This email is to advise you about files and folders loaded into the portal by a ' +
    'committee member. When a committee member loads something, they retain ownership of it, and ' +
    'it needs to be owned by the secretary account instead.</p>' +
    '<p>Each step below is a single click. Do them in order &ndash; folders first, then loose ' +
    'files &ndash; and anything inside a folder is handled by that folder&rsquo;s link. If the ' +
    'result page says a file is linked from the portal menu, follow the instruction on that page.</p>';

  MailApp.sendEmail({
    to: getNotifyEmails().join(','),
    subject: 'Strata portal: ' + step + ' step(s) to take ownership of ' + items.length +
      ' item(s) in Committee Documents',
    htmlBody: introHtml + folderBlocks.join('') + fileBlocks.join(''),
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
  if (!fileId) return expiredPage('<p>The link is missing its file ID.</p>');

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return expiredPage('<p>That file could not be opened. It has probably been moved or deleted already.</p>');
  }

  if (!isItemInAuditScope(file)) {
    return page('<p>That file is not inside the Strata Committee Documents folder, so this tool won’t touch it.</p>');
  }

  const owner = file.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : null;
  if (ownerEmail === SECRETARY_EMAIL) {
    return expiredPage('<p>“' + escapeHtml(file.getName()) + '” is already owned by the secretary account. Nothing to do.</p>');
  }

  // Anyone on the notify list can click this link, and someone else may
  // already have. If the original's already trashed, a previous click
  // already fully processed it (the not-linked, auto-trash path). Report
  // that plainly instead of quietly making a second, redundant copy.
  if (file.isTrashed()) {
    return expiredPage('<p>“' + escapeHtml(file.getName()) + '” has already been actioned: someone already made a ' +
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
      return expiredPage('<p>A secretary-owned copy of <strong>' + escapeHtml(originalName) + '</strong> already exists, ' +
        'someone else already actioned this.</p>' +
        '<p><a href="' + parentFolder.getUrl() + '" target="_blank">View the documents in Google Drive</a></p>' +
        '<p>If the original (owned by ' + escapeHtml(ownerEmail) + ') hasn’t been deleted yet, delete it ' +
        'from that folder.</p>');
    }
  }

  const copy = file.makeCopy(originalName, parentFolder);

  let html =
    '<p>Made a secretary-owned copy of <strong>' + escapeHtml(originalName) + '</strong>.</p>' +
    '<p><a href="' + parentFolder.getUrl() + '" target="_blank">View the documents in Google Drive</a> ' +
    'to see every copy and who owns each one.</p>';

  // Shown whenever the original is left in place; the folder link above is where to delete it.
  const originalLink = '<p>The one to delete is the copy owned by ' + ownerEmail + '.</p>';

  // Check the live Portal Menu Sheet before trashing anything - trashing a
  // file that's currently a nav tab would break that tab's embed. Fail
  // SAFE if the Sheet can't be read: leave the original alone rather than
  // risk trashing something that's actually still live in the menu.
  const menu = getMenuLinkedFileIds();
  const menuName = menu.ok ? menu.ids[originalId] : undefined;

  if (!menu.ok) {
    html += '<p><strong>Could not check the Portal Menu Sheet just now</strong>, so the original ' +
      'has been left alone rather than risk trashing something still linked from the nav. Check ' +
      'by hand, then trash it yourself in Drive once you’re sure it’s safe to.</p>' + originalLink;
  } else if (menuName) {
    html += '<p><strong>Action needed:</strong> this file is linked from the main menu as “' +
      menuName + '”, so the original has been left alone rather than trashed. Update that ' +
      'row’s Link in the Portal Menu Sheet to the new copy’s URL below, then trash the ' +
      'original yourself once that change is live:</p>' +
      '<p><code>' + copy.getUrl() + '</code></p>' + originalLink;
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
        'Trash yourself in Drive so there aren’t two live copies.</p>' + originalLink;
    } else {
      html += '<p>The original (previously owned by ' + ownerEmail + ') has been moved to Trash, ' +
        'so only the new copy is visible in the folder now. It’s recoverable from Drive’s Trash ' +
        'for about 30 days if that turns out to be wrong.</p>';
    }
  }

  return page(html);
}

// --- The one-click folder and files fixes ---

// Drive's API can't hand ownership of someone else's file to this account,
// only make a secretary-owned copy (and trash the original), so "take
// ownership of a folder" is done as: rename the old folder "X - old",
// create a new secretary-owned "X", then walk the old folder and copy or
// move everything across, recursing into subfolders. Safe to run twice: a
// repeat click finds the "X - old" / "X" pair and carries on with whatever
// is still left, which is also how a run that hit Apps Script's time limit
// is finished off.
const TIME_BUDGET_MS = 5 * 60 * 1000;

function newReport() {
  return {
    started: Date.now(),
    incomplete: false,
    copied: 0,
    moved: 0,
    foldersMade: 0,
    trashedOriginals: 0,
    menuLinked: [],     // { name, menuName, url } - original left alone
    menuUnchecked: [],  // { name, url } - original left alone
    failed: [],         // { name, error }
    oldFoldersLeft: [], // names of "- old" folders that couldn't be trashed
  };
}

function timeUp(rep) {
  if (Date.now() - rep.started > TIME_BUDGET_MS) {
    rep.incomplete = true;
    return true;
  }
  return false;
}

function isSecretaryOwned(item) {
  const owner = item.getOwner();
  return !!owner && owner.getEmail().toLowerCase() === SECRETARY_EMAIL;
}

function fixFolderAction(folderId) {
  if (!folderId) return expiredPage('<p>The link is missing its folder ID.</p>');

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    return expiredPage('<p>That folder could not be opened. It has probably been moved or deleted already.</p>');
  }

  // A finished fix trashes the emptied "- old" folder, but Drive still lets
  // getFolderById open a trashed folder, so check for it explicitly.
  if (folder.isTrashed()) {
    return expiredPage('<p>“' + escapeHtml(folder.getName()) + '” has already been fixed and removed. ' +
      'Nothing more to do here.</p>');
  }

  if (!isItemInAuditScope(folder)) {
    return page('<p>That folder is not inside the Strata Committee Documents folder, so this tool won’t touch it.</p>');
  }

  if (isSecretaryOwned(folder)) {
    return expiredPage('<p>“' + escapeHtml(folder.getName()) + '” is already owned by the secretary account. Nothing to do.</p>');
  }

  const parents = folder.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getFolderById(FOLDER_ID);

  const rep = newReport();
  const menu = getMenuLinkedFileIds();
  const newFolder = fixBadFolder(folder, parentFolder, menu, rep);

  return page(
    '<p>Folder “' + escapeHtml(newFolder.getName()) + '” and its contents are now owned by the ' +
    'secretary account.</p>' +
    '<p><a href="' + newFolder.getUrl() + '" target="_blank">Open the new folder</a></p>' +
    renderReport(rep)
  );
}

// Fixes every wrongly-owned file sitting directly in one folder, in place
// (copy next to the original, trash the original). Subfolders are left to
// their own links.
function fixFilesAction(folderId) {
  if (!folderId) return expiredPage('<p>The link is missing its folder ID.</p>');

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    return expiredPage('<p>That folder could not be opened. It has probably been moved or deleted already.</p>');
  }

  if (folder.isTrashed()) {
    return expiredPage('<p>“' + escapeHtml(folder.getName()) + '” has already been removed. Nothing more to do here.</p>');
  }

  if (folder.getId() !== FOLDER_ID && !isItemInAuditScope(folder)) {
    return page('<p>That folder is not inside the Strata Committee Documents folder, so this tool won’t touch it.</p>');
  }

  // Nothing wrongly owned left directly in this folder means an earlier click
  // (or an earlier folder fix) already dealt with them.
  let anyToFix = false;
  const check = folder.getFiles();
  while (check.hasNext() && !anyToFix) {
    if (!isSecretaryOwned(check.next())) anyToFix = true;
  }
  if (!anyToFix) {
    return expiredPage('<p>There are no files left in “' + escapeHtml(folder.getName()) +
      '” that need fixing. Someone has already done this.</p>');
  }

  const rep = newReport();
  const menu = getMenuLinkedFileIds();
  fixFilesIn(folder, menu, rep);

  return page(
    '<p>Checked the files in “' + escapeHtml(folder.getName()) + '”.</p>' +
    '<p><a href="' + folder.getUrl() + '" target="_blank">View the folder in Google Drive</a></p>' +
    renderReport(rep)
  );
}

// Renames a wrongly-owned folder out of the way (unless an earlier run
// already did), makes or finds its secretary-owned replacement inside
// `destParent`, and moves everything across. Returns the replacement.
function fixBadFolder(oldFolder, destParent, menu, rep) {
  const name = oldFolder.getName();
  const alreadyRenamed = / - old$/.test(name);
  const cleanName = name.replace(/ - old$/, '');

  let newFolder = null;
  if (alreadyRenamed) {
    const existing = destParent.getFoldersByName(cleanName);
    while (existing.hasNext() && !newFolder) {
      const candidate = existing.next();
      if (isSecretaryOwned(candidate)) newFolder = candidate;
    }
  }
  if (!newFolder) {
    if (!alreadyRenamed) oldFolder.setName(name + ' - old');
    newFolder = destParent.createFolder(cleanName);
    rep.foldersMade++;
  }

  // Collect first, then act: the iterators are live and we're moving items
  // out of the folder as we go.
  const files = [];
  const fileIt = oldFolder.getFiles();
  while (fileIt.hasNext()) files.push(fileIt.next());
  const subs = [];
  const subIt = oldFolder.getFolders();
  while (subIt.hasNext()) subs.push(subIt.next());

  files.forEach(function (f) {
    if (timeUp(rep)) return;
    fixFileInto(f, newFolder, menu, rep);
  });

  subs.forEach(function (sub) {
    if (timeUp(rep)) return;
    if (isSecretaryOwned(sub)) {
      sub.moveTo(newFolder);
      rep.moved++;
      fixTreeInPlace(sub, menu, rep);
    } else {
      fixBadFolder(sub, newFolder, menu, rep);
    }
  });

  if (!rep.incomplete) trashIfEmpty(oldFolder, rep);
  return newFolder;
}

// Fixes wrongly-owned files and folders inside an already secretary-owned
// folder, where they sit.
function fixTreeInPlace(folder, menu, rep) {
  fixFilesIn(folder, menu, rep);
  const subs = [];
  const subIt = folder.getFolders();
  while (subIt.hasNext()) subs.push(subIt.next());
  subs.forEach(function (sub) {
    if (timeUp(rep)) return;
    if (isSecretaryOwned(sub)) {
      fixTreeInPlace(sub, menu, rep);
    } else {
      fixBadFolder(sub, folder, menu, rep);
    }
  });
}

function fixFilesIn(folder, menu, rep) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.forEach(function (f) {
    if (timeUp(rep)) return;
    if (isSecretaryOwned(f)) return;
    fixFileInto(f, folder, menu, rep);
  });
}

// Gets one file into `target` owned by the secretary: moves it if it's
// already secretary-owned, otherwise makes a copy there and trashes the
// original - except when the original is linked from the live portal menu
// (or the menu couldn't be checked), which is left alone and reported.
function fixFileInto(file, target, menu, rep) {
  const name = file.getName();
  const id = file.getId();

  if (isSecretaryOwned(file)) {
    file.moveTo(target);
    rep.moved++;
    return;
  }

  try {
    // A copy may already exist from an earlier, interrupted run.
    let copy = null;
    const existing = target.getFilesByName(name);
    while (existing.hasNext() && !copy) {
      const c = existing.next();
      if (c.getId() !== id && isSecretaryOwned(c)) copy = c;
    }
    if (!copy) {
      copy = file.makeCopy(name, target);
      rep.copied++;
    }

    const menuName = menu.ok ? menu.ids[id] : undefined;
    if (!menu.ok) {
      rep.menuUnchecked.push({ name: name, url: copy.getUrl() });
    } else if (menuName) {
      rep.menuLinked.push({ name: name, menuName: menuName, url: copy.getUrl() });
    } else {
      // Advanced Drive Service rather than DriveApp: see the longer note
      // in copyFileAction about DriveApp.setTrashed() refusing files the
      // secretary account doesn't own.
      Drive.Files.update({ trashed: true }, id);
      rep.trashedOriginals++;
    }
  } catch (err) {
    rep.failed.push({ name: name, error: err.message });
  }
}

function trashIfEmpty(folder, rep) {
  if (folder.getFiles().hasNext() || folder.getFolders().hasNext()) {
    rep.oldFoldersLeft.push(folder.getName());
    return;
  }
  try {
    Drive.Files.update({ trashed: true }, folder.getId());
  } catch (err) {
    rep.oldFoldersLeft.push(folder.getName());
  }
}

function renderReport(rep) {
  let html = '<p>Copied ' + rep.copied + ' file(s) into secretary-owned versions, moved ' + rep.moved +
    ' item(s) that were already secretary-owned, trashed ' + rep.trashedOriginals + ' original(s). ' +
    'Trashed items are recoverable from Drive’s Trash for about 30 days.</p>';

  if (rep.incomplete) {
    html += '<p><strong>This hit the time limit before finishing.</strong> Click the same link in ' +
      'the email again and it will carry on where it left off.</p>';
  }
  if (rep.menuLinked.length) {
    html += '<p><strong>Action needed &ndash; linked from the portal menu.</strong> The originals ' +
      'below were left in place so the menu doesn’t break. For each, update its Link in the Portal ' +
      'Menu Sheet to the new copy’s URL, then trash the original:</p><ul>' +
      rep.menuLinked.map(function (m) {
        return '<li>' + escapeHtml(m.name) + ' (menu item “' + escapeHtml(m.menuName) + '”)<br>' +
          '<code>' + escapeHtml(m.url) + '</code></li>';
      }).join('') + '</ul>';
  }
  if (rep.menuUnchecked.length) {
    html += '<p><strong>Couldn’t check the Portal Menu Sheet just now</strong>, so these originals ' +
      'were left alone. Check by hand, then trash them yourself if they aren’t linked:</p><ul>' +
      rep.menuUnchecked.map(function (m) {
        return '<li>' + escapeHtml(m.name) + '<br><code>' + escapeHtml(m.url) + '</code></li>';
      }).join('') + '</ul>';
  }
  if (rep.failed.length) {
    html += '<p><strong>These could not be fully processed:</strong></p><ul>' +
      rep.failed.map(function (f) {
        return '<li>' + escapeHtml(f.name) + ': ' + escapeHtml(f.error) + '</li>';
      }).join('') + '</ul>';
  }
  if (rep.oldFoldersLeft.length) {
    html += '<p>These old folders still need deleting by hand in Drive (not empty, or Drive wouldn’t ' +
      'let the script trash them): ' + rep.oldFoldersLeft.map(escapeHtml).join(', ') + '.</p>';
  }
  return html;
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

// Shown whenever a link in an email no longer applies (item already fixed,
// moved, trashed or deleted, or a damaged link), so a stale link says so
// plainly instead of looking broken. `detailHtml` explains why.
function expiredPage(detailHtml) {
  return page('<h2 style="margin-top:0;">Link expired</h2>' +
    '<p>This link is no longer valid.</p>' + (detailHtml || ''));
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
