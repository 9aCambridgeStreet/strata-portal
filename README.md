# 9A Cambridge St Committee Portal

One link for the committee's shared documents, to-do list and Slack, behind
Google Sign-In. A static site (no server, no build step) hosted on GitHub
Pages at https://9acambridgestreet.github.io/strata-portal/.

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
- **Documents**, **To-Do List** and **10 Year Budget** are iframes showing the
  Drive folder and two Google Sheets, so Drive's own sharing also protects the
  content itself. Documents uses Drive's list view; the file count next to its
  "Open in Google Drive" link comes from the membership script's
  `?action=count` endpoint, not from Drive's own embed.
- **Slack** is a plain link.

## Where everything lives

Everything is owned by `secretary.9a.cambridge.st@gmail.com`, so nothing
depends on any individual member's accounts.

| Piece | Where |
| --- | --- |
| Website code | GitHub account `9aCambridgeStreet`, repo `strata-portal` (push to `main` redeploys) |
| Google sign-in client | Google Cloud project `strata-committee-portal`, client `StrataAuth`, published (not in Testing) |
| Membership script | Apps Script project "Strata Portal Membership" in the secretary's Drive |
| Chat-history viewer script | Separate Apps Script project (see "Embedding a Plain HTML File" below), one per plain-HTML page |
| Documents | Drive folder "Strata Committee Documents" |
| To-do list | "Committee To-Do List" sheet, in the folder's Planning subfolder |
| 10 Year Budget | "10 Year Sinking Fund Forecast - Costs Estimates" sheet, in the folder's Planning subfolder |

## Changing things

- **Settings** (name, folder ID, sheet ID, Slack link, script URL) are in
  `js/config.js`.
- **The membership script:** edit `apps-script/Code.gs` here, paste it into the
  Apps Script editor, then **Deploy > Manage deployments > edit > New version**.
  Editing the existing deployment keeps the same URL. A brand new deployment
  gets a new URL, which would then need updating in `js/config.js`.
- **A chat-history viewer script:** same process, but in its own Apps Script
  project (**Deploy > Manage deployments > edit > New version** on that
  project, not the membership one), see "Embedding a Plain HTML File" below.
- **If the Documents folder is ever replaced,** update both `driveFolderId` in
  `js/config.js` and `FOLDER_ID` in the script.
- **If the site moves to a new address,** add it to the OAuth client's
  Authorized JavaScript origins, and update the home page, privacy and terms
  links on the Google Auth Platform Branding page.
- **Cache busting:** bump the `?v=N` on a file's `<script>`/`<link>` tag in
  `index.html` whenever that file changes.

`privacy.html` and `terms.html` exist because Google requires them to publish
the sign-in app.

## Adding a New Page

A page in this portal is just a tab: one entry in the nav bar, and one panel
in `index.html` holding an iframe pointed at something in Google Drive. The
Home, Documents and To-Do List tabs are all built from the same three pieces,
so the fastest way to add a fourth is to copy one of them and change the
details.

**Here's How:**

1. In `index.html`, add a nav item inside `<nav class="portal-nav">`:
   ```html
   <div class="nav-item" data-tab="handbook" role="button">Handbook</div>
   ```
   The `data-tab` value is the name that ties the nav item to its panel, so
   pick something short and use the same value in step 2.

2. In the same file, add a panel inside `<main>`, matching the `data-tab`
   value from step 1:
   ```html
   <div class="tab-panel" data-tab="handbook" hidden>
     <div class="frame-toolbar">
       <a id="handbookOpenLink" href="#" target="_blank" rel="noopener">Open in Google Docs &#8599;</a>
     </div>
     <iframe id="handbookFrame" class="embed-frame" title="Handbook"></iframe>
   </div>
   ```
   Give the link and the iframe their own `id` values, since step 4 needs
   both.

3. In `js/config.js`, add the ID of the Drive file to embed, with a comment
   explaining what it is (see `portalHomeDocId` for the pattern to follow).

4. In `js/app.js`, inside `onSignedIn()`, set the iframe source and the open
   link from that config value:
   ```js
   document.getElementById('handbookFrame').src = `https://docs.google.com/document/d/${CONFIG.handbookDocId}/preview`;
   document.getElementById('handbookOpenLink').href = `https://docs.google.com/document/d/${CONFIG.handbookDocId}/edit`;
   ```
   A Google Sheet follows the same pattern with `spreadsheets/d/` in place of
   `document/d/`. A Drive folder uses
   `https://drive.google.com/embeddedfolderview?id=FOLDER_ID#list` instead,
   the way the Documents tab already does.

5. Bump the `?v=N` on `config.js` and `app.js` in `index.html`, since both
   files just changed.

**Note:** the new file only shows content to committee members if it lives
inside the Strata Committee Documents folder, or another folder shared the
same way. A file sitting anywhere else in Drive needs its own separate
sharing, and until it has that, members will see nothing wrong on screen,
just an empty frame where the content should be.

**Note:** this recipe only works for a native Google file, a Doc, a Sheet or
a folder. Drive deliberately refuses to render a plain uploaded `.html` file
as a live page, since running someone's uploaded script inside the
`drive.google.com` origin would be a serious security hole, so it shows the
source as text instead. A page built from a plain HTML file (like the Slack
chat-history export) needs a small Apps Script web app in front of it
instead, see the next section.

**Tip:** the toolbar link on every tab sits at the top left by default
(`.frame-toolbar` in `css/style.css`), so a new page matches the rest of the
portal without any extra styling.

## Embedding a Plain HTML File (Not a Native Google File)

Some content the committee wants on the portal isn't a Doc, a Sheet or a
Drive folder, it's a plain `.html` file someone else's tool produced, for
example the weekly Slack chat-history export in the strata-slack-export-bot
project. Drive won't render that kind of file as a live page (see the note
above), so this needs a tiny Apps Script web app to stand in front of it.

`apps-script/ChatHistoryViewer.gs` (with its manifest,
`ChatHistoryViewer.appsscript.json`) is the working example, built for the
chat-history export. It's a second, separate Apps Script project from the
membership script, because it needs a different deployment setting: rather
than verifying a token the portal's own JavaScript sends it, this one relies
on Apps Script's own Google sign-in, so `Session.getActiveUser().getEmail()`
tells it who's asking, checked against the same Documents folder sharing as
everywhere else.

**Here's How (one-time setup for a new file):**

1. In [script.google.com](https://script.google.com), signed in as the
   secretary account, create a new project.
2. Paste in the code from `apps-script/ChatHistoryViewer.gs` (typing it by
   hand risks the editor's auto-closing brackets quietly corrupting it, the
   same trap as the membership script).
3. Open **Project Settings** (the gear icon) and paste the contents of
   `ChatHistoryViewer.appsscript.json` over the existing manifest, so the
   deployment settings below are already set correctly.
4. **Deploy > New deployment > Web app**, with:
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone with a Google account**
5. Copy the web app URL Google gives you. That's the link to hand to
   committee members, or to embed as a portal tab with the "Adding a New
   Page" recipe above (its iframe source is just that URL, no `/preview` or
   file ID needed, the script already knows which file to serve).

**Note:** step 4's settings matter. "Execute as: me" (the setting the
membership script uses) would run this as the secretary account for every
visitor, with no way to tell who's actually asking. "Anyone" without "with a
Google account" would skip the sign-in step entirely, and Session would
never learn who was asking either.

## Handing over to a new committee

They need two logins: the secretary Gmail (Drive, Apps Script and Google Cloud)
and the `9aCambridgeStreet` GitHub account.
