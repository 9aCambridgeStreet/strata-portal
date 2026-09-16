function showLoginMessage(message, isError) {
  const el = document.getElementById('loginError');
  el.textContent = message;
  el.classList.toggle('is-status', !isError);
  el.hidden = false;
}

function showLoginError(message) {
  showLoginMessage(message, true);
}

function showLoginStatus(message) {
  showLoginMessage(message, false);
}

function onSignedIn(profile) {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('portal').hidden = false;

  document.getElementById('userName').textContent = profile.name || profile.email;
  document.getElementById('userAvatar').src = profile.picture || '';

  // Falls back to the old direct-embed if homeViewerUrl hasn't been filled
  // in yet (see "Rendering the Home Doc as a Responsive Page" in the
  // README) - keeps the Home tab working, just not phone-friendly, until
  // that one-time Apps Script deployment is done.
  document.getElementById('homeFrame').src = CONFIG.homeViewerUrl
    || `https://docs.google.com/document/d/${CONFIG.portalHomeDocId}/preview`;
  document.getElementById('homeOpenLink').href = `https://docs.google.com/document/d/${CONFIG.portalHomeDocId}/edit`;
  document.getElementById('driveFrame').src = `https://drive.google.com/embeddedfolderview?id=${CONFIG.driveFolderId}#list`;
  // Google refuses to frame the editable Sheet (frame-ancestors), so embed the
  // read-only preview and send people to Sheets itself to make changes.
  document.getElementById('sheetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/preview`;
  document.getElementById('driveOpenLink').href = `https://drive.google.com/drive/folders/${CONFIG.driveFolderId}`;
  document.getElementById('sheetOpenLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;
  document.getElementById('slackLink').href = CONFIG.slackUrl;

  showTab('home');
}

function showTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tab !== tabName;
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });
}

function initPortal() {
  document.title = CONFIG.strataName;
  document.querySelectorAll('[data-portal-name]').forEach((el) => {
    el.textContent = CONFIG.strataName;
  });

  document.querySelectorAll('.nav-item[data-tab]').forEach((item) => {
    item.addEventListener('click', () => showTab(item.dataset.tab));
  });

  document.getElementById('signOutButton').addEventListener('click', signOut);

  initAuth();
}

document.addEventListener('DOMContentLoaded', initPortal);
