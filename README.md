# Strata Committee Portal

A single static site (no server, no build step) that gives the committee one
link for shared documents, a to-do list and Slack, gated behind Google
Sign-In. Runs entirely in the browser, same pattern as this workspace's other
static sites (flight-tracker, galton-board).

## How it works

- **Sign-In with Google** runs client-side via Google's own script. It hands
  back the signed-in email, which is checked against a hardcoded list in
  `js/config.js`.
- This check happens in the browser, so it is a convenience gate, not real
  security. The actual protection is whatever the Drive folder and Sheet are
  shared with inside Google. Keep the sharing lists and `allowedEmails` in
  `js/config.js` in sync.
- **Documents** and **To-Do List** are just iframes pointed at a shared Drive
  folder and a Google Sheet.
- **Slack** is a plain link that opens in a new tab.

## One-time setup (do this under the committee's shared Gmail)

Sign in to that Gmail account for every step below, so the whole portal is
owned by the committee, not by any one person.

### 1. Create the Google Sign-In client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create
   a new project (any name, e.g. "Strata Committee Portal").
2. Go to **APIs & Services > OAuth consent screen**. Choose **External**,
   fill in an app name and the committee's email as support/contact email.
   You do not need to submit it for verification, "Testing" mode is fine for
   a small internal group, just add each committee email under "Test users".
3. Go to **APIs & Services > Credentials > Create Credentials > OAuth client
   ID**. Choose **Web application**.
4. Under **Authorized JavaScript origins**, add the exact URL the site will
   be served from (e.g. `https://yourname.github.io`). You can add more
   origins later if the URL changes.
5. Copy the generated Client ID into `js/config.js` as `googleClientId`.

### 2. Share the Drive folder and Sheet

1. Create (or pick) a Drive folder for committee documents, and a Sheet for
   the to-do list, owned by the committee Gmail.
2. Share both with each committee member's email address, the same emails
   that go into `allowedEmails`.
3. Copy the folder ID from its URL (`drive.google.com/drive/folders/THIS`)
   into `driveFolderId`, and the sheet ID from its URL
   (`docs.google.com/spreadsheets/d/THIS/edit`) into `sheetId`.

### 3. Fill in the rest of `js/config.js`

Edit `strataName`, `allowedEmails` (lowercase, one per committee member) and
`slackUrl`.

### 4. Create the GitHub account and repo, then enable Pages

1. Create a new GitHub account using the committee Gmail
   (https://github.com/signup). This account owns the portal, so whoever
   chairs the committee holds its login.
2. Create a new repository (e.g. `strata-portal`), and push this folder's
   contents to it.
3. In the repo's **Settings > Pages**, set the source to the `main` branch,
   root folder. GitHub will publish it at
   `https://<account-name>.github.io/strata-portal/`.
4. Go back to step 1 above and make sure that exact URL is in the OAuth
   client's Authorized JavaScript origins.

From then on, updating the site is just editing files and pushing, GitHub
Pages redeploys automatically.

## Running locally to preview changes

No build step, just serve the folder:

```
python -m http.server 8000
```

Then open `http://localhost:8000`. Google Sign-In will not complete unless
`localhost:8000` (or whatever port you use) is also added as an authorized
origin in the OAuth client, useful for testing before it's live.

## Handing the portal to a new committee

Whoever takes over needs the committee Gmail login (for Drive/Sheet sharing
and the Google Cloud project) and the GitHub account login (to edit
`allowedEmails` as membership changes). Nothing here depends on any
individual's personal accounts.
