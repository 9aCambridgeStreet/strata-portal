// Sign-in with Google, using Google Identity Services (loaded client-side,
// no server involved). Checks the signed-in email against CONFIG.allowedEmails.
//
// This check happens entirely in the browser, so it is a convenience gate,
// not real security. The actual protection for documents and the to-do list
// is whatever the Drive folder and Sheet are shared with in Google itself.
// Keep that sharing list in sync with CONFIG.allowedEmails.

const AUTH_STORAGE_KEY = 'strataPortal.session';

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - (str.length % 4)) % 4, '=');
  return decodeURIComponent(
    atob(padded)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
}

function decodeJwt(credential) {
  const payload = credential.split('.')[1];
  return JSON.parse(base64UrlDecode(payload));
}

function saveSession(profile) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(profile));
}

function loadSession() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const profile = JSON.parse(raw);
    if (profile.exp && Date.now() / 1000 > profile.exp) {
      clearSession();
      return null;
    }
    return profile;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function isEmailAllowed(email) {
  return CONFIG.allowedEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

function handleCredentialResponse(response) {
  const profile = decodeJwt(response.credential);

  if (!isEmailAllowed(profile.email)) {
    showLoginError(`${profile.email} is not on the committee access list. Ask an existing member to add you.`);
    return;
  }

  saveSession(profile);
  onSignedIn(profile);
}

function initAuth() {
  const existing = loadSession();
  if (existing) {
    onSignedIn(existing);
    return;
  }

  if (typeof google === 'undefined') {
    showLoginError('Could not reach Google to sign in. Check your internet connection and reload the page.');
    return;
  }

  google.accounts.id.initialize({
    client_id: CONFIG.googleClientId,
    callback: handleCredentialResponse,
  });

  google.accounts.id.renderButton(document.getElementById('googleSignInButton'), {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
  });
}

function signOut() {
  clearSession();
  google.accounts.id.disableAutoSelect();
  window.location.reload();
}
