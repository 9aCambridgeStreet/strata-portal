# 9A Cambridge St Committee Portal

One link for the committee's shared documents, to-do list and Slack, behind
Google Sign-In. A static site (no server, no build step) hosted on GitHub
Pages at https://9acambridgestreet.github.io/strata-portal/.

## Adding or removing a committee member

Share (or unshare) the **Strata Committee Documents** Drive folder with them.
That's the only step, there is no list to edit anywhere else. A fresh sign-in
picks up the change within about a minute, but see "When a Member Leaves the
Committee" below for what happens to someone who already has the portal open.

The person needs a Google account for that email address to sign in.

## When a Member Leaves the Committee

Removing a member is a Google Drive change, not a portal change. The sharing
list on the **Strata Committee Documents** folder *is* the membership list,
so taking someone off it is the entire job, with no code to touch and
nothing else to update.

**Here's How:**

1. Open the **Strata Committee Documents** folder in Google Drive, signed in
   as the secretary account.
2. Open **Share**, find the person's email address, and remove them.

That's it. The next time anyone signs in, `checkMember()` in
`apps-script/Code.gs` reads the same sharing list, so a person no longer on
it is no longer a member.

**Note:** removing someone from Drive doesn't cut off their access the
instant you click, because the portal checks membership in two different
places, on two different clocks.

### The Portal Login Screen

Signing in to the portal checks membership exactly once, at the moment of
sign in, not on every page load. `handleCredentialResponse()` in `js/auth.js`
runs that check, and once it passes, the browser saves the result to
`localStorage` and never checks again until it expires. Think of it like a
building pass someone has already swiped through the front door. Taking
their name off the tenant list at reception doesn't march them back out of
the lobby, it just stops the next swipe from working.

So if a member is already signed in, or reloads the portal before their
local session expires, they still see the Home tab and the full nav bar,
because the portal isn't asking Drive again, it's reading what it already
decided last time. That cached session lasts for as long as the Google
sign-in token stays valid, normally about an hour, or until the member
clicks **Sign out**.

### The Documents, Sheets and Drive Folder

The actual content is a different story. Every Doc, Sheet and the Drive
folder link on the Documents tab talks to Google Drive directly, and Drive
checks sharing on every single request, with no caching of its own. So the
moment you unshare the folder, the Home and Operating Approach docs stop
loading, the To-Do List and 10 Year Budget sheets stop loading, and the
Documents link takes the person to a Google "you need access" page instead
of the folder, regardless of what the portal still thinks.

**Tip:** in practice a removed member keeps an empty-looking shell of the
portal open for a while, but can't read anything inside it. If you want them
locked out the moment you unshare rather than fading out over the following
hour, just tell them their access has ended, since nothing in the portal
will actually open for them from that point on.

**Note:** there's one more small delay worth knowing about. The Apps Script
also caches the membership list for 60 seconds (`CACHE_SECONDS` in
`apps-script/Code.gs`), a separate cache from the session one above. Wait a
minute after unsharing before testing that a removed member is properly
locked out, so you're not chasing a false positive.

## How it works

- **Sign in** uses Google Identity Services in the browser.
- **Membership** is decided by a small Google Apps Script (source in
  `apps-script/`), deployed as a web app under the secretary account. The
  portal sends it the Google sign-in token. The script verifies the token with
  Google, then checks whether that email is on the Documents folder's sharing
  list (owner, editors or viewers). Results are cached for 60 seconds.
- **To-Do List** and **10 Year Budget** are iframes showing two Google
  Sheets, so Drive's own sharing also protects the content itself.
  **Documents** is a plain link straight to the Drive folder (opens in a new
  tab) rather than an embedded tab, so there's no separate iframe or "Open in
  Google Drive" toolbar link for it.
- **Slack** is two plain links, not one auto-detecting one: "Slack App"
  (`slack://open`, the URL scheme both the mobile and desktop Slack apps
  register) and "Slack Browser" (`CONFIG.slackUrl`). An earlier version tried
  to open the app and silently fall back to the browser link if nothing
  answered within a timeout, but detecting whether a custom scheme actually
  opened an app is just a timing guess on iOS, and it kept guessing wrong on
  a real iPad - the fallback fired even when the app had opened successfully,
  leaving an unwanted Slack-login tab behind. Two explicit links removes the
  guess entirely. "Slack Browser" clicks are counted (not shown anywhere in
  the portal) so Matt can see, via a weekly email, whether anyone actually
  uses it - see "Slack Browser click tracking" below.

## Where everything lives

Everything is owned by `secretary.9a.cambridge.st@gmail.com`, so nothing
depends on any individual member's accounts.

| Piece | Where |
| --- | --- |
| Website code | GitHub account `9aCambridgeStreet`, repo `strata-portal` (push to `main` redeploys) |
| Google sign-in client | Google Cloud project `strata-committee-portal`, client `StrataAuth`, published (not in Testing) |
| Membership script | Apps Script project "Strata Portal Membership" in the secretary's Drive |
| Chat-history viewer script | Separate Apps Script project (see "Embedding a Plain HTML File" below), one per plain-HTML page |
| Ownership audit script | Separate Apps Script project "Strata Ownership Audit" (see "Ownership Audit" below) |
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

## Slack Browser click tracking

Every click on the "Slack Browser" nav link (not "Slack App") is counted by
`apps-script/Code.gs`, purely so Matt can see whether anyone actually uses
it and decide later whether to remove it. The counts aren't shown anywhere
in the portal - instead, a weekly email goes to Matt with this week's count
and the all-time total, then the weekly count resets to 0.

**One-time setup**, after pasting `Code.gs` into the live Apps Script
project (see "Changing things" above): open the project in the Apps Script
editor, select `setupWeeklyTrigger` from the function dropdown next to the
Run button, and click Run once. That's it - it creates a trigger that fires
`sendWeeklySlackClickReport` every Monday at 8am, and keeps doing so on its
own. **Don't run it more than once** (check Triggers, the clock icon in the
left sidebar, if unsure whether it's already set up), or the email goes out
twice every week.

## Ownership Audit

Sharing the Documents folder with someone doesn't change who *owns* a file
they upload or create inside it, ownership stays with their personal Google
account. If that person later leaves the committee, or their sharing is
removed, the file itself is untouched, they're still the owner and can still
delete it or reshare it whenever they like. If they ever close their Google
account entirely, anything they solely own disappears from the folder with
no warning to anyone.

`apps-script/OwnershipAudit.gs` (with its manifest,
`OwnershipAudit.appsscript.json`) checks for this daily: it walks the whole
Documents folder tree and, only when it finds something, emails the
current notify list (see below) a list of every file or subfolder not
owned by `secretary.9a.cambridge.st@gmail.com`. Each file in that email
gets a "make a secretary-owned copy" link, clicking it runs under the
secretary account (same deployment setting as the membership script),
creates a copy owned by the secretary in the same folder, and **moves the
original to Drive's Trash** in the same step, so the folder never ends up
showing two live copies of the same document with no obvious way to tell
which one is now the real one. Trashing isn't a permanent delete, it's
recoverable from Drive's own Trash for about 30 days if that ever turns out
to be the wrong call.

**The exception is a file that's currently a nav tab.** The portal's nav
bar is built entirely from the "Portal Menu" Sheet (the same one Code.gs's
`getMenu()` serves to the portal, one row per tab, a Link column pointing
at the Drive file it embeds), not from `js/config.js` - the four
Drive-ID fields still sitting in `js/config.js` (`portalHomeDocId`,
`agreedProcessesDocId`, `budgetSheetId`, `sheetId`) are leftovers nothing
actually reads any more. So before trashing anything, the copy action
reads that same Menu Sheet directly (`getMenuLinkedFileIds()` in
`OwnershipAudit.gs`) and checks whether the file being copied is one of
its links. If it is, the original is left alone rather than trashed, and
the confirmation page (and the audit email, in advance) names the menu row
and asks you to repoint its Link at the new copy's URL first, then trash
the old one yourself once that's live. If the Sheet can't be read at all
(renamed, restructured, a bad moment), it fails safe the same way, leaving
the original untouched rather than risk trashing a live nav tab. This
needed adding the same "Sheets" Advanced Service and a `spreadsheets`
scope to `OwnershipAudit.appsscript.json` that Code.gs already uses for
the same lookup (`spreadsheets.readonly` looked right and is enough for
the Advanced Sheets Service call, but `SpreadsheetApp.openById()` itself
needs the full `spreadsheets` scope even just to read - the readonly
scope silently broke every menu-link check from the day this was built,
until the error was finally logged and traced in September 2026).

**Here's How (one-time setup):**

1. In [script.google.com](https://script.google.com), signed in as the
   secretary account, create a new project.
2. Paste in the code from `apps-script/OwnershipAudit.gs` (paste, don't type
   by hand, same auto-closing-bracket trap as the other scripts here).
3. Open **Project Settings** (the gear icon) and paste the contents of
   `OwnershipAudit.appsscript.json` over the existing manifest.
4. **Deploy > New deployment > Web app**, with:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Open the project, select `setupDailyOwnershipCheck` from the function
   dropdown next to the Run button, and click Run once. Check Triggers (the
   clock icon) first if you're ever unsure whether it's already set up,
   running it twice means two emails on any day something is found.

**Note:** like the membership script's URL, this deployment's web app URL
is unguarded by anything beyond being hard to guess, don't publish or share
it, it's only meant to appear inside the audit email itself.

**Changing who gets the email, no code needed:** the recipient list isn't
hardcoded, it's a Script Property, which has its own settings screen. In
the Apps Script editor: gear icon (**Project Settings**) > **Script
properties** > **Add script property** (or edit it if one's already
there) > key `notifyEmails`, value a comma-separated list, e.g.
`secretary.9a.cambridge.st@gmail.com, someone@else.com` > Save. Takes
effect on the next run, no redeploy. Defaults to the secretary account plus
`matthew.j.allington@gmail.com` until that property is ever set.
(`setNotifyEmails('a@x.com, b@y.com')` does the same thing from a function
call if you're ever editing the script anyway, but the Project Settings
screen above needs no code at all.)

**Updating the script:** same pattern as the others, edit
`OwnershipAudit.gs` here, paste it into its Apps Script project, then
**Deploy > Manage deployments > edit > New version**.

## Adding a New Page

A page in this portal is just a tab: one entry in the nav bar, and one panel
in `index.html` holding an iframe pointed at something in Google Drive. The
Home and To-Do List tabs are built from the same three pieces, so the
fastest way to add another is to copy one of them and change the details.
(Documents is the exception: it's a plain link straight to the Drive folder,
not a tab, see the nav item's `documentsLink` id in `index.html`.)

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
   `document/d/`. A Drive folder can either embed the same way with
   `https://drive.google.com/embeddedfolderview?id=FOLDER_ID#list`, or link
   straight out to `https://drive.google.com/drive/folders/FOLDER_ID` the way
   the Documents nav item does (see `documentsLink` in `js/app.js`).

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
