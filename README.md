# 9A Cambridge St Committee Portal

One link for the committee's shared documents, to-do list and Slack, behind
Google Sign-In. A static site (no server, no build step) hosted on GitHub
Pages at https://secretary9acambridge.github.io/strata-portal/.

## Adding or removing a committee member

Share (or unshare) the **Strata Committee Documents** Drive folder with them.
That's the only step. Portal access follows the folder's sharing within about
a minute, and there is no list to edit anywhere else.

The person needs a Google account for that email address to sign in.

## How it works

- **Sign in** uses Google Identity Services in the browser.
- **Membership** is decided by a small Google Apps Script (source in
  `apps-script/`), deployed as a web app under the secretary account. The
  portal sends it the Google sign-in token. The script verifies the token with
  Google, then checks whether that email is on the Documents folder's sharing
  list (owner, editors or viewers). Results are cached for 60 seconds.
- **Documents** and **To-Do List** are iframes showing the Drive folder and a
  Google Sheet, so Drive's own sharing also protects the content itself.
- **Slack** is a plain link.

## Where everything lives

Everything is owned by `secretary.9a.cambridge.st@gmail.com`, so nothing
depends on any individual member's accounts.

| Piece | Where |
| --- | --- |
| Website code | GitHub account `Secretary9aCambridge`, repo `strata-portal` (push to `main` redeploys) |
| Google sign-in client | Google Cloud project `strata-committee-portal`, client `StrataAuth`, published (not in Testing) |
| Membership script | Apps Script project "Strata Portal Membership" in the secretary's Drive |
| Documents | Drive folder "Strata Committee Documents" |
| To-do list | "Committee To-Do List" sheet, in the folder's Planning subfolder |

## Changing things

- **Settings** (name, folder ID, sheet ID, Slack link, script URL) are in
  `js/config.js`.
- **The membership script:** edit `apps-script/Code.gs` here, paste it into the
  Apps Script editor, then **Deploy > Manage deployments > edit > New version**.
  Editing the existing deployment keeps the same URL. A brand new deployment
  gets a new URL, which would then need updating in `js/config.js`.
- **If the Documents folder is ever replaced,** update both `driveFolderId` in
  `js/config.js` and `FOLDER_ID` in the script.
- **If the site moves to a new address,** add it to the OAuth client's
  Authorized JavaScript origins, and update the home page, privacy and terms
  links on the Google Auth Platform Branding page.
- **Cache busting:** bump the `?v=N` on a file's `<script>`/`<link>` tag in
  `index.html` whenever that file changes.

`privacy.html` and `terms.html` exist because Google requires them to publish
the sign-in app.

## Handing over to a new committee

They need two logins: the secretary Gmail (Drive, Apps Script and Google Cloud)
and the `Secretary9aCambridge` GitHub account.
