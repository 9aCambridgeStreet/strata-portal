// Edit this file to configure the portal for your strata committee.
// No build step is needed, just edit and push.

const CONFIG = {
  // Shown in the header and browser tab.
  strataName: '9A Cambridge St Committee',

  // The OAuth Client ID from Google Cloud Console (APIs & Services > Credentials).
  // Must be created under the committee's shared Google account, with this
  // site's exact URL added under "Authorized JavaScript origins".
  googleClientId: '983495642617-v0a00ou5rj018d2vjp0veqq0kjuk29je.apps.googleusercontent.com',

  // Web app URL of the membership Apps Script (apps-script/Code.gs). Members are
  // whoever the Drive folder below is shared with, there is no list to edit here.
  membershipUrl: 'https://script.google.com/macros/s/AKfycbxMlDJk5pz4Vu_VEiTXeYX3cAnrP1-pIOYPTknwK_KghrhmyEWr8zz5wkJ-OH1cnPeX/exec',

  // The ID of the Google Doc shown on the Home tab, embedded directly the
  // same way as the Documents and To-Do tabs.
  // Find it in the doc's URL: docs.google.com/document/d/THIS_PART/edit
  portalHomeDocId: '1c25axkB_KaTPaZXksvpXh1FFL-BCOhj-NNyD7vOuOIc',

  // The ID of the Google Doc shown on the Operating Approach tab, embedded
  // directly the same way as the Home, Documents and To-Do tabs.
  // Find it in the doc's URL: docs.google.com/document/d/THIS_PART/edit
  agreedProcessesDocId: '12IZwt4u3C9uHAdsAnkthy5rnqwIgLxQNzdlP3-ZI85Q',

  // The ID of the Google Sheet shown on the 10 Year Budget tab, embedded
  // directly the same way as the To-Do tab.
  // Find it in the sheet's URL: docs.google.com/spreadsheets/d/THIS_PART/edit
  budgetSheetId: '1ZmX6EnsJ20UTBMGt0f3e0772mWwFO7T6UHVLqsuqUCk',

  // The ID of the shared Google Drive folder to embed on the Documents tab.
  // Sharing this folder is what grants portal access. If it changes, update
  // FOLDER_ID in apps-script/Code.gs too.
  // Find it in the folder's URL: drive.google.com/drive/folders/THIS_PART
  driveFolderId: '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi',

  // The ID of the Google Sheet to embed on the To-Do tab.
  // Find it in the sheet's URL: docs.google.com/spreadsheets/d/THIS_PART/edit
  sheetId: '1Knvz5_q8ImCxUp-CVDUJo5-7bnvOBwMhUSnzttE_bvo',

  // Full URL of the Slack workspace or channel to link to.
  slackUrl: 'https://9acambridgestreet.slack.com',
};
