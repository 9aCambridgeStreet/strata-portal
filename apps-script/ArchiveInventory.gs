// One-off, READ-ONLY inventory of the Archive folder tree inside Strata
// Committee Documents, used to plan moving those files into the main numbered
// folders (older than 2026 -> an "Archive" subfolder of the subject folder).
// Changes nothing in Drive: it only lists files and folders. Run
// inventoryArchive() from the editor under the secretary account, then read
// the execution log (JSON rows, logged in chunks so the log doesn't truncate).
// Safe to delete once the sort is done.

const INV_ARCHIVE_FOLDER_ID = '1j7bJo7As-V02RO5gIQfRaKcSy93GV4l_';
const INV_CHUNK = 40;

function inventoryArchive() {
  const rows = [];
  const root = DriveApp.getFolderById(INV_ARCHIVE_FOLDER_ID);
  walkInventory(root, 'Archive', rows);
  Logger.log('TOTAL ROWS: ' + rows.length);
  for (let i = 0; i < rows.length; i += INV_CHUNK) {
    Logger.log('CHUNK ' + (i / INV_CHUNK + 1) + ': ' + JSON.stringify(rows.slice(i, i + INV_CHUNK)));
  }
}

function walkInventory(folder, path, rows) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    rows.push({
      path: path,
      name: f.getName(),
      type: f.getMimeType(),
      id: f.getId(),
      size: f.getSize(),
      created: f.getDateCreated().toISOString().slice(0, 10),
      modified: f.getLastUpdated().toISOString().slice(0, 10),
    });
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    rows.push({ path: path, name: sub.getName(), type: 'folder', id: sub.getId() });
    walkInventory(sub, path + ' / ' + sub.getName(), rows);
  }
}
