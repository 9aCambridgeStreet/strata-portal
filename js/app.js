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

  loadMenu();
}

// v2: the cached shape changed from a bare items array to {portalName,
// items} - a new key sidesteps any old-format cache left over in a
// browser from before that change.
const MENU_CACHE_KEY = 'strataPortal.menuCacheV2';

// Menu (and the portal's display name, from the sheet's PortalName named
// range) are driven by the "Portal Menu" Sheet - see apps-script/Code.gs's
// getMenu action. Row order = tab order, and each row's embed type is
// worked out from its Link URL shape.
//
// Stale-while-revalidate: render last time's data instantly from
// localStorage if there is any, then always fetch a fresh copy in the
// background and store it for next time. The menu rarely changes, so
// showing yesterday's tabs for one extra reload is a fine trade for not
// making every visit wait on a live Apps Script round trip. Only shows a
// loading/error state when there's nothing cached yet (first-ever visit).
function loadMenu() {
  const cached = readMenuCache();
  if (cached) applyMenuData(cached);

  fetch(`${CONFIG.membershipUrl}?action=getMenu`)
    .then((res) => res.json())
    .then((data) => {
      writeMenuCache(data);
      if (!cached) applyMenuData(data);
    })
    .catch(() => {
      if (!cached) {
        document.getElementById('portalNav').innerHTML =
          '<span class="nav-loading">Could not load the menu. Try reloading.</span>';
      }
    });
}

function applyMenuData(data) {
  // Empty/missing PortalName (not filled in yet, or the named range was
  // deleted) keeps whatever config.js's strataName already put on screen
  // rather than blanking the title out.
  if (data.portalName) applyPortalName(data.portalName);
  renderMenu(data.items || []);
}

function applyPortalName(name) {
  document.title = name;
  document.querySelectorAll('[data-portal-name]').forEach((el) => {
    el.textContent = name;
  });
}

function readMenuCache() {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function writeMenuCache(items) {
  try {
    localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(items));
  } catch (err) {
    // Storage full or blocked (e.g. private browsing) - fine, it just
    // means no instant-load next time; the live fetch still works.
  }
}

function slugify(name, index) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return (slug || 'tab') + '-' + index;
}

function renderMenu(items) {
  const nav = document.getElementById('portalNav');
  const main = document.getElementById('portalMain');
  nav.innerHTML = '';
  main.innerHTML = '';

  // 'folder' (a Drive folder link, e.g. the Documents row) is deliberately
  // NOT embeddable - Drive's own folder-view iframe is a clunky, read-only
  // list, which is exactly why the real portal moved away from it. It
  // renders as a plain external link, same as 'link'.
  const embeddable = { doc: true, sheet: true };
  let firstTab = null;

  items
    .filter((item) => item.kind !== 'empty')
    .forEach((item, index) => {
      if (!embeddable[item.kind]) {
        // 'link' kind: a plain external link, no tab/panel of its own.
        const navEl = document.createElement('a');
        navEl.className = 'nav-item';
        navEl.href = item.link;
        navEl.target = '_blank';
        navEl.rel = 'noopener';
        navEl.textContent = item.name + ' ↗';
        nav.appendChild(navEl);
        return;
      }

      const tabName = slugify(item.name, index);
      if (!firstTab) firstTab = tabName;

      const navEl = document.createElement('div');
      navEl.className = 'nav-item';
      navEl.dataset.tab = tabName;
      navEl.setAttribute('role', 'button');
      navEl.textContent = item.name;
      navEl.addEventListener('click', () => showTab(tabName));
      nav.appendChild(navEl);

      const panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.dataset.tab = tabName;
      panel.hidden = true;

      const openLink = document.createElement('a');
      openLink.target = '_blank';
      openLink.rel = 'noopener';

      const iframe = document.createElement('iframe');
      iframe.className = 'embed-frame';
      iframe.title = item.name;

      if (item.kind === 'doc') {
        iframe.src = `https://docs.google.com/document/d/${item.id}/preview`;
        openLink.href = `https://docs.google.com/document/d/${item.id}/edit`;
        openLink.textContent = 'Open in Google Docs ↗';
      } else {
        // Google refuses to frame the editable Sheet (frame-ancestors), so
        // embed the read-only preview and send people to Sheets itself to
        // make changes - same trick the hardcoded tabs always used.
        iframe.src = `https://docs.google.com/spreadsheets/d/${item.id}/preview`;
        openLink.href = `https://docs.google.com/spreadsheets/d/${item.id}/edit`;
        openLink.textContent = 'Open in Google Sheets ↗';
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'frame-toolbar';
      toolbar.appendChild(openLink);

      panel.appendChild(toolbar);
      panel.appendChild(iframe);
      main.appendChild(panel);
    });

  if (firstTab) showTab(firstTab);
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

  document.getElementById('signOutButton').addEventListener('click', signOut);

  // Nav-item click handlers are now wired per-item inside renderMenu(),
  // since the menu itself is built dynamically after sign-in. The old
  // Slack Browser click-tracking wiring lived here too, but it targeted a
  // fixed #slackBrowserLink element that no longer exists now the menu is
  // dynamic - left out for now, pending Matt confirming whether per-item
  // click tracking (the sheet's "Click Count" column) is still wanted.

  initAuth();
}

document.addEventListener('DOMContentLoaded', initPortal);
