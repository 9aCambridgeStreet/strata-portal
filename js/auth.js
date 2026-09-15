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
  const res = await fetch(CONFIG.membershipUrl, {
    method: 'POST',
    body: JSON.stringify({ token: credential }),
  });
  return res.json();
}

async function handleCredentialResponse(response) {
  const profile = decodeJwt(response.credential);
  showLoginStatus('Checking committee membership...');

  let result;
  try {
    result = await checkMembership(response.credential);
  } catch {
    showLoginError('Could not check committee membership right now. Please try again in a moment.');
    return;
  }

  if (!result.member) {
    showLoginError(`${profile.email} doesn't have access to the committee documents folder. Ask the secretary to share it with you.`);
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
