// Edit this file to configure the portal for your strata committee.
// No build step is needed, just edit and push.

const CONFIG = {
  // Shown in the header and browser tab.
  strataName: 'Strata Committee Portal',

  // The OAuth Client ID from Google Cloud Console (APIs & Services > Credentials).
  // Must be created under the committee's shared Google account, with this
  // site's exact URL added under "Authorized JavaScript origins".
  googleClientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Only these email addresses (lowercase) may sign in. Add or remove
  // committee members here as the committee changes over time.
  allowedEmails: [
    'someone@gmail.com',
  ],

  // The ID of the shared Google Drive folder to embed on the Documents tab.
  // Find it in the folder's URL: drive.google.com/drive/folders/THIS_PART
  driveFolderId: 'YOUR_DRIVE_FOLDER_ID',

  // The ID of the Google Sheet to embed on the To-Do tab.
  // Find it in the sheet's URL: docs.google.com/spreadsheets/d/THIS_PART/edit
  sheetId: 'YOUR_SHEET_ID',

  // Full URL of the Slack workspace or channel to link to.
  slackUrl: 'https://yourworkspace.slack.com',
};
