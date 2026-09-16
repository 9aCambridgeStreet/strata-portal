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
  document.getElementById('driveFrame').src = `https://drive.google.com/embeddedfolderview?id=${CONFIG.driveFolderId}#list`;
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

// The Slack web login (browser tab -> credentials -> confirmation code) has
// no way to stay signed in inside an iOS/iPadOS home-screen portal, since
// that flow opens in an isolated browser context with its own cookie jar,
// separate from both Safari and the Slack app. `slack://open` is Slack's own
// URL scheme for "open the installed app" - the desktop apps (Windows/Mac)
// register the same scheme, so this one link handles phone, tablet and PC.
// If no app answers within SLACK_APP_TIMEOUT_MS (no installed app, or a
// browser that blocks custom schemes), it falls back to CONFIG.slackUrl.
//
// 700ms was too eager: on a real iPad, the app opens fine but the page's
// blur event can land after the timer already fired, so the fallback opened
// a second, unwanted Slack-login tab even on success. Longer timeout, and
// watching visibilitychange as well as blur (iOS backgrounds the tab for the
// app switch either way), makes that false trigger far less likely. The
// fallback also now replaces the current tab rather than opening a new one,
// since a `window.open` called this long after the original tap sits
// outside Safari's "was this a real user gesture" window and can silently
// no-op instead of actually opening - simpler to just navigate directly.
const SLACK_APP_TIMEOUT_MS = 1500;

function initSlackLink() {
  const link = document.getElementById('slackLink');
  link.addEventListener('click', (event) => {
    event.preventDefault();

    let handedOff = false;
    const markHandedOff = () => {
      handedOff = true;
    };
    window.addEventListener('blur', markHandedOff, { once: true });
    document.addEventListener('visibilitychange', markHandedOff, { once: true });

    window.location.href = 'slack://open';

    setTimeout(() => {
      window.removeEventListener('blur', markHandedOff);
      document.removeEventListener('visibilitychange', markHandedOff);
      if (!handedOff) {
        window.location.href = link.href;
      }
    }, SLACK_APP_TIMEOUT_MS);
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
  initSlackLink();

  initAuth();
}

document.addEventListener('DOMContentLoaded', initPortal);
