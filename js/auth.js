// Sign-in with Google. Membership is decided by the Apps Script in apps-script/,
// which verifies the Google token and checks the committee Drive folder's sharing
// list, so sharing that folder is the only membership list to maintain.

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

async function checkMembership(credential) {
  // A plain-text body keeps this a simple request, so the browser sends no CORS preflight.
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
  const res = await fetch(CONFIG.membershipUrl, {
    method: 'POST',
    body: JSON.stringify({ token: credential }),
    signal: timeout,
  });
  if (!res.ok) throw new Error('membership check returned ' + res.status);
  return res.json();
}

async function handleCredentialResponse(response) {
  const profile = decodeJwt(response.credential);
  showLoginStatus('Checking committee membership...');

  let result;
  try {
    result = await checkMembership(response.credential);
  } catch (err) {
    console.error('Membership check failed', err);
    showLoginError(`Could not check committee membership (${err.name === 'TimeoutError' ? 'the check timed out' : err.message}). Check your connection, or try again in a private window in case a browser extension is blocking it.`);
    return;
  }

  if (!result.member) {
    showLoginError(`${profile.email} doesn't have access to the committee documents folder. Ask the secretary to share it with you.`);
    return;
  }

  saveSession(profile);
  try {
    onSignedIn(profile);
  } catch (err) {
    console.error('Could not open the portal', err);
    showLoginError('Signed in, but the portal failed to open: ' + err.message);
  }
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
