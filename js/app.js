function showLoginError(message) {
  const el = document.getElementById('loginError');
  el.textContent = message;
  el.hidden = false;
}

function onSignedIn(profile) {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('portal').hidden = false;

  document.getElementById('userName').textContent = profile.name || profile.email;
  document.getElementById('userAvatar').src = profile.picture || '';

  document.getElementById('driveFrame').src = `https://drive.google.com/embeddedfolderview?id=${CONFIG.driveFolderId}#list`;
  document.getElementById('sheetFrame').src = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit?usp=sharing&rm=minimal&widget=true`;
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
