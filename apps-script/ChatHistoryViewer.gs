// Serves the Slack chat-history export as a real, live webpage, gated by
// the same Drive-sharing membership as the rest of the portal.
//
// This is a SEPARATE Apps Script project and web app from the membership
// check in Code.gs, because it needs a different deployment setting.
// Code.gs is deployed as "Execute as: me" so any browser can call it and
// have it verify a Google sign-in token passed in from the portal's own
// JavaScript. This script instead needs Apps Script's own native login, so
// it must be deployed as:
//   Execute as: User accessing the web app
//   Who has access: Anyone with a Google account
// With that setting, Google forces a sign-in before this code ever runs,
// and Session.getActiveUser().getEmail() reliably returns the visitor's
// real address, no token-passing needed.

const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const CHAT_HISTORY_FILE_ID = '1RM9P58fiuY7wZNSQNBPtdg3Ej6te5jzM'; // 9acambridgestreet-chat-history.html

function doGet() {
  const email = Session.getActiveUser().getEmail();

  if (!email || !isMember(email)) {
    return page(
      '<p>This page is only available to 9A Cambridge St committee members.</p>' +
      '<p>Signed in as: ' + (email || 'nobody') + '</p>'
    );
  }

  const html = DriveApp.getFileById(CHAT_HISTORY_FILE_ID).getBlob().getDataAsString();
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isMember(email) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const people = [folder.getOwner()].concat(folder.getEditors(), folder.getViewers());
  return people
    .filter(function (p) { return p; })
    .some(function (p) { return p.getEmail().toLowerCase() === email.toLowerCase(); });
}

function page(bodyHtml) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;max-width:480px;">' + bodyHtml + '</div>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
