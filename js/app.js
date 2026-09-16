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
  // Grid view (rather than list) skips Drive's own Owner/Last modified
  // columns, which is all we can control on a view Google renders itself.
  document.getElementById('driveFrame').src = `https://drive.google.com/embeddedfolderview?id=${CONFIG.driveFolderId}#grid`;
  // Google refuses to frame the editable Sheet (frame-ancestors), so embed the
  // read-only preview and send people to Sheets itself to make changes.
  document.getElementById('sheetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/preview`;
  document.getElementById('driveOpenLink').href = `https://drive.google.com/drive/folders/${CONFIG.driveFolderId}`;
  document.getElementById('sheetOpenLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;
  document.getElementById('processesFrame').src = `https://docs.google.com/document/d/${CONFIG.agreedProcessesDocId}/preview`;
  document.getElementById('processesOpenLink').href = `https://docs.google.com/document/d/${CONFIG.agreedProcessesDocId}/edit`;
  document.getElementById('budgetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.budgetSheetId}/preview`;
  document.getElementById('budgetOpenLink').href = `https://docs.google.com/spreadsheets/d/${CONFIG.budgetSheetId}/edit`;
  document.getElementById('slackLink').href = CONFIG.slackUrl;
  loadDocumentsFileCount();

  showTab('home');
}

// Asks the membership script for how many files are in the Documents folder,
// since Drive's own embedded view has no built-in count. Fails silently
// (leaves the toolbar blank) if the script is on an older version that
// doesn't support this yet, or the request errors for any other reason.
function loadDocumentsFileCount() {
  fetch(`${CONFIG.membershipUrl}?action=count`)
    .then((res) => res.json())
    .then((data) => {
      if (typeof data.count !== 'number') return;
      const el = document.getElementById('documentsFileCount');
      el.textContent = `${data.count} file${data.count === 1 ? '' : 's'}`;
    })
    .catch(() => {});
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
