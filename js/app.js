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

  document.getElementById('homeFrame').src = `https://docs.google.com/document/d/${CONFIG.portalHomeDocId}/preview`;
  document.getElementById('homeOpenLink').href = `https://docs.google.com/document/d/${CONFIG.portalHomeDocId}/edit`;
  document.getElementById('documentsLink').href = `https://drive.google.com/drive/folders/${CONFIG.driveFolderId}`;
  // Google refuses to frame the editable Sheet (frame-ancestors), so embed the
  // read-only preview and send people to Sheets itself to make changes.
  document.getElementById('sheetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/preview`;
  document.getElementById('sheetOpenLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;
  document.getElementById('processesFrame').src = `https://docs.google.com/document/d/${CONFIG.agreedProcessesDocId}/preview`;
  document.getElementById('processesOpenLink').href = `https://docs.google.com/document/d/${CONFIG.agreedProcessesDocId}/edit`;
  document.getElementById('budgetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.budgetSheetId}/preview`;
  document.getElementById('budgetOpenLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.budgetSheetId}/edit`;
  // Two separate links rather than one auto-detecting one: detecting whether
  // a custom URL scheme actually opened an app is a timing guess on iOS,
  // and kept guessing wrong on a real iPad even after tuning it twice. A
  // person can tell instantly which one they want; the page can't.
  document.getElementById('slackAppLink').href = 'slack://open';
  document.getElementById('slackBrowserLink').href = CONFIG.slackUrl;

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

  // Fire-and-forget: lets Matt see (via a weekly email from the membership
  // script) whether anyone actually uses the browser fallback link, so he
  // can decide later whether to remove it. Never blocks the link's own
  // navigation, and a failed/blocked request just means one click goes
  // uncounted, nothing else depends on it.
  document.getElementById('slackBrowserLink').addEventListener('click', () => {
    fetch(`${CONFIG.membershipUrl}?action=trackSlackBrowserClick`).catch(() => {});
  });

  initAuth();
}

document.addEventListener('DOMContentLoaded', initPortal);
