// One-off helpers for sorting the Archive folder tree inside Strata Committee
// Documents into the main numbered folders (older than 2026 -> an "Archive"
// subfolder of the subject folder). Run from the Apps Script editor under the
// secretary account. Needs the Drive API (v3) advanced service enabled.
// Safe to delete once the sort is done.
//
//   inventoryArchive()  - READ-ONLY. Logs every file/folder in the tree.
//   ocrBatch()          - makes a temporary Google Doc copy of each PDF/Word/
//                         image to read its text, trashes the copy straight
//                         away, and saves date candidates + a text snippet per
//                         file in Script Properties. Photos use the
//                         photo-taken date from Drive's image metadata. Stops
//                         at ~4.5 min; just run it again until it says DONE.
//   dumpResults()       - logs what ocrBatch collected, in small pieces.

const INV_ARCHIVE_FOLDER_ID = '1j7bJo7As-V02RO5gIQfRaKcSy93GV4l_';

function inventoryArchive() {
  const lines = listArchiveFiles().map(function (f) {
    return [f.path, f.name, shortType(f.type), f.id, f.modified].join(' | ');
  });
  logChunks('TOTAL ROWS: ' + lines.length, lines);
}

function logChunks(header, lines) {
  Logger.log(header);
  for (let i = 0; i < lines.length; i += 20) {
    Logger.log('P' + (i / 20 + 1) + '\n' + lines.slice(i, i + 20).join('\n'));
  }
}

function shortType(m) {
  const map = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/heif': 'heic',
    'application/vnd.google-apps.document': 'gdoc',
    'application/vnd.google-apps.spreadsheet': 'gsheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[m] || m;
}

// Every file (not folder) under the Archive folder, in a stable order.
function listArchiveFiles() {
  const out = [];
  walkArchive(DriveApp.getFolderById(INV_ARCHIVE_FOLDER_ID), 'Archive', out);
  return out;
}

function walkArchive(folder, path, out) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    out.push({
      path: path,
      name: f.getName(),
      type: f.getMimeType(),
      id: f.getId(),
      modified: f.getLastUpdated().toISOString().slice(0, 10),
    });
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    walkArchive(sub, path + ' / ' + sub.getName(), out);
  }
}

const OCR_TIME_BUDGET_MS = 4.5 * 60 * 1000;
const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';

function dateCandidates(text) {
  const res = [
    /\b20\d{2}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:20)?\d{2}\b/g,
    new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTHS + '\\.?,?\\s+\\d{4}\\b', 'gi'),
    new RegExp('\\b' + MONTHS + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b', 'gi'),
    new RegExp('\\b' + MONTHS + '\\s+\\d{4}\\b', 'gi'),
  ];
  const found = [];
  res.forEach(function (re) {
    const m = text.match(re) || [];
    m.forEach(function (d) {
      if (found.indexOf(d) === -1) found.push(d);
    });
  });
  return found.slice(0, 6);
}

// Text of a file, via a temporary Google Doc copy (Drive converts and OCRs it),
// trashed again straight away.
function textOf(file) {
  const doc = Drive.Files.create(
    { name: 'tmp-ocr-' + file.getId(), mimeType: 'application/vnd.google-apps.document' },
    file.getBlob(),
    { ocrLanguage: 'en' }
  );
  try {
    return DocumentApp.openById(doc.id).getBody().getText().slice(0, 3000);
  } finally {
    Drive.Files.update({ trashed: true }, doc.id);
  }
}

function photoDate(id) {
  const meta = Drive.Files.get(id, { fields: 'imageMediaMetadata(time),createdTime,modifiedTime' });
  const t = meta.imageMediaMetadata && meta.imageMediaMetadata.time;
  return t ? 'taken ' + t : 'no photo date (created ' + meta.createdTime.slice(0, 10) + ')';
}

function ocrBatch() {
  const props = PropertiesService.getScriptProperties();
  const started = Date.now();
  const files = listArchiveFiles();
  let done = 0;
  let left = 0;
  files.forEach(function (f) {
    const key = 'r_' + f.id;
    if (props.getProperty(key)) {
      done++;
      return;
    }
    if (Date.now() - started > OCR_TIME_BUDGET_MS) {
      left++;
      return;
    }
    let result;
    try {
      if (f.type === 'image/heif' || (f.path.indexOf('maintenance') !== -1 && /^image\//.test(f.type))) {
        result = photoDate(f.id);
      } else {
        const text = textOf(DriveApp.getFileById(f.id));
        const snippet = text.replace(/\s+/g, ' ').slice(0, 90);
        result = dateCandidates(text).join('; ') + ' :: ' + snippet;
      }
    } catch (err) {
      result = 'ERROR ' + String(err).slice(0, 80);
    }
    props.setProperty(key, result);
    done++;
  });
  Logger.log((left ? 'MORE TO DO, run again. ' : 'DONE. ') + 'processed ' + done + ' of ' + files.length);
}

function dumpResults() {
  const props = PropertiesService.getScriptProperties();
  const files = listArchiveFiles();
  const lines = files.map(function (f, i) {
    const short = f.path.replace('Archive / ', '').replace('Portal download', 'PD').replace('Kristy / PD', 'K');
    return i + ' | ' + short + ' | ' + f.name + ' | ' + (props.getProperty('r_' + f.id) || 'NONE');
  });
  logChunks('TOTAL ' + lines.length, lines);
}
