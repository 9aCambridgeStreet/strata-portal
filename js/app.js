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
const MENU_CACHE_KEY = 'strataPortal.menuCacheV3';

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

// Each tab gets a shareable URL hash (e.g. #voting) built from its menu
// name alone, so the link survives the menu being reordered. tabName (with
// its index) stays the internal id; this maps hash -> tabName.
let tabHashes = {};

function hashFor(name, used) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tab';
  let hash = base;
  for (let n = 2; used[hash]; n++) hash = base + '-' + n;
  return hash;
}

function tabFromLocationHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();
  return hash ? tabHashes[hash] || null : null;
}

window.addEventListener('hashchange', () => {
  const tabName = tabFromLocationHash();
  if (tabName) showTab(tabName, true);
});

function renderMenu(items) {
  const nav = document.getElementById('portalNav');
  const main = document.getElementById('portalMain');
  nav.innerHTML = '';
  main.innerHTML = '';
  tabHashes = {};

  // 'folder' (a Drive folder link, e.g. the Documents row) is deliberately
  // NOT embeddable - Drive's own folder-view iframe is a clunky, read-only
  // list, which is exactly why the real portal moved away from it. It
  // renders as a plain external link, same as 'link'.
  const embeddable = { doc: true, sheet: true };
  let firstTab = null;
  // Each item's nav element, collected here and placed (top level or inside
  // a group dropdown) by assembleNav() once every item has been built.
  const navEls = new Map();

  items
    .filter((item) => item.kind !== 'empty')
    .forEach((item, index) => {
      // A menu row whose link is exactly "#votes" is the built-in voting
      // tool (js/votes.js), not an embedded Google file or external link.
      if (item.link === '#votes') {
        const tabName = slugify(item.name, index);
        tabHashes[hashFor(item.name, tabHashes)] = tabName;
        if (!firstTab) firstTab = tabName;

        const navEl = document.createElement('div');
        navEl.className = 'nav-item';
        navEl.dataset.tab = tabName;
        navEl.setAttribute('role', 'button');
        navEl.textContent = item.name;
        navEl.addEventListener('click', () => showTab(tabName));
        navEls.set(item, navEl);

        const panel = document.createElement('div');
        panel.className = 'tab-panel votes-panel';
        panel.dataset.tab = tabName;
        panel.dataset.votes = '1';
        panel.hidden = true;
        main.appendChild(panel);
        return;
      }

      if (!embeddable[item.kind]) {
        // 'link' kind: a plain external link, no tab/panel of its own.
        const navEl = document.createElement('a');
        navEl.className = 'nav-item';
        navEl.href = item.link;
        navEl.target = '_blank';
        navEl.rel = 'noopener';
        navEl.textContent = item.name + ' ↗';
        navEls.set(item, navEl);
        return;
      }

      const tabName = slugify(item.name, index);
      tabHashes[hashFor(item.name, tabHashes)] = tabName;
      if (!firstTab) firstTab = tabName;

      const navEl = document.createElement('div');
      navEl.className = 'nav-item';
      navEl.dataset.tab = tabName;
      navEl.setAttribute('role', 'button');
      navEl.textContent = item.name;
      navEl.addEventListener('click', () => showTab(tabName));
      navEls.set(item, navEl);

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

  assembleNav(nav, items, navEls);

  // A shared link like #voting opens that tab; otherwise the first tab.
  const linked = tabFromLocationHash();
  if (linked || firstTab) showTab(linked || firstTab, true);
}

// Menu groups, driven by the Sheet's optional "Group" column: rows sharing a
// Group value collect into one dropdown (an accordion on phones). The
// dropdown sits where a row named after the group with a blank Link is, or
// at its first member if there is no such row. Matching ignores case and
// stray spaces. A group with a single member is just shown as a plain item.
function normalizeGroup(value) {
  return String(value || '').trim().toLowerCase();
}

function assembleNav(nav, items, navEls) {
  const groups = {};
  items.forEach((item) => {
    const key = normalizeGroup(item.group);
    if (!key || !navEls.has(item)) return;
    if (!groups[key]) groups[key] = { label: item.group.trim(), members: [], placed: false };
    groups[key].members.push(item);
  });

  // A header row = no Link (so no nav element of its own) whose name matches
  // a group some other row names.
  const headers = new Map();
  items.forEach((item) => {
    const key = normalizeGroup(item.name);
    if (!navEls.has(item) && groups[key] && !headers.has(key)) headers.set(key, item);
  });

  items.forEach((item) => {
    if (navEls.has(item)) {
      const key = normalizeGroup(item.group);
      if (!key) {
        nav.appendChild(navEls.get(item));
      } else if (!headers.has(key) && !groups[key].placed) {
        groups[key].placed = true;
        nav.appendChild(buildNavGroup(groups[key], navEls, groups[key].label));
      }
      return;
    }
    const key = normalizeGroup(item.name);
    if (headers.get(key) === item) {
      groups[key].placed = true;
      nav.appendChild(buildNavGroup(groups[key], navEls, item.name.trim()));
    }
  });
}

function buildNavGroup(group, navEls, label) {
  if (group.members.length === 1) return navEls.get(group.members[0]);

  const wrap = document.createElement('div');
  wrap.className = 'nav-group';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-item nav-group-toggle';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = label;
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  toggle.appendChild(caret);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = wrap.classList.contains('open');
    closeNavGroups();
    if (!wasOpen) openNavGroup(wrap);
  });

  const sub = document.createElement('div');
  sub.className = 'submenu';
  group.members.forEach((member) => sub.appendChild(navEls.get(member)));

  wrap.appendChild(toggle);
  wrap.appendChild(sub);
  return wrap;
}

function openNavGroup(wrap) {
  wrap.classList.add('open');
  wrap.querySelector('.nav-group-toggle').setAttribute('aria-expanded', 'true');
}

function closeNavGroups() {
  document.querySelectorAll('.nav-group.open').forEach((wrap) => {
    wrap.classList.remove('open');
    wrap.querySelector('.nav-group-toggle').setAttribute('aria-expanded', 'false');
  });
}

// fromHash: the change came from the URL (or the default first tab), so
// leave the address bar alone rather than rewriting it.
function showTab(tabName, fromHash) {
  if (!fromHash) {
    const hash = Object.keys(tabHashes).find((h) => tabHashes[h] === tabName);
    if (hash && location.hash !== '#' + hash) history.replaceState(null, '', '#' + hash);
  }

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tab !== tabName;
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });
  // A group's heading counts as active while one of its items is showing.
  document.querySelectorAll('.nav-group').forEach((wrap) => {
    wrap.querySelector('.nav-group-toggle').classList.toggle(
      'active',
      !!wrap.querySelector('.submenu .nav-item.active')
    );
  });

  // The voting tab loads its data when first shown, and again on each
  // revisit so the tallies are never stale.
  const votesPanel = document.querySelector(`.tab-panel[data-tab="${tabName}"][data-votes]`);
  if (votesPanel) {
    if (CONFIG.votingUrl) votesOpen(votesPanel);
    else votesPanel.textContent = 'Voting is not set up yet.';
  }
}

// Phone-only: the nav is a plain horizontal tab strip down to tablet width
// (see the max-width: 700px block in style.css, which real tablets never hit
// even in portrait), and only collapses into this toggled dropdown below
// that. Closing on any nav-item click means picking a tab, or following an
// external link, both tidy the menu away again on its own.
function toggleMobileMenu() {
  const nav = document.getElementById('portalNav');
  const isOpen = nav.classList.toggle('is-open');
  document.getElementById('menuToggle').setAttribute('aria-expanded', String(isOpen));
  // Opening the menu reveals the group holding the current page, so the
  // accordion starts expanded where the visitor already is.
  if (isOpen) {
    const current = nav.querySelector('.nav-group .nav-item.active:not(.nav-group-toggle)');
    if (current) openNavGroup(current.closest('.nav-group'));
  }
}

function closeMobileMenu() {
  document.getElementById('portalNav').classList.remove('is-open');
  document.getElementById('menuToggle').setAttribute('aria-expanded', 'false');
}

function initPortal() {
  document.title = CONFIG.strataName;
  document.querySelectorAll('[data-portal-name]').forEach((el) => {
    el.textContent = CONFIG.strataName;
  });

  document.getElementById('signOutButton').addEventListener('click', signOut);
  document.getElementById('menuToggle').addEventListener('click', toggleMobileMenu);
  // Delegated, so it keeps working after renderMenu() rebuilds the nav's
  // children on every menu load/refresh.
  document.getElementById('portalNav').addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    // A group heading only opens/closes its own list; picking a real item
    // (or external link) tidies the dropdown and the phone menu away.
    if (navItem && !navItem.classList.contains('nav-group-toggle')) {
      closeNavGroups();
      closeMobileMenu();
    }
  });
  // Desktop dropdowns close on an outside click or Esc. Not on phones,
  // where the groups are an accordion inside the hamburger menu.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#portalNav')) return;
    if (!window.matchMedia('(max-width: 700px)').matches) closeNavGroups();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNavGroups();
  });

  // Nav-item click handlers are now wired per-item inside renderMenu(),
  // since the menu itself is built dynamically after sign-in. The old
  // Slack Browser click-tracking wiring lived here too, but it targeted a
  // fixed #slackBrowserLink element that no longer exists now the menu is
  // dynamic - left out for now, pending Matt confirming whether per-item
  // click tracking (the sheet's "Click Count" column) is still wanted.

  initAuth();
}

document.addEventListener('DOMContentLoaded', initPortal);
