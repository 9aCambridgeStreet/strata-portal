// Serves the Home tab's Google Doc as a real, responsive webpage, instead
// of embedding Google's own /preview iframe - that iframe renders a
// fixed-width printed-page layout with no way for this site's CSS to
// reach into it, so it never reflows properly on a phone. This script
// reads the Doc's own content and rewrites it as plain, mobile-friendly
// HTML, gated by the same Drive-sharing membership as the rest of the
// portal.
//
// This is a SEPARATE Apps Script project and web app from the membership
// check in Code.gs (same reasoning as ChatHistoryViewer.gs): it needs
// Apps Script's own native login, deployed as:
//   Execute as: User accessing the web app
//   Who has access: Anyone with a Google account
// so Session.getActiveUser().getEmail() reliably returns the visitor's
// real address, no token-passing needed.
//
// IMPORTANT - the Home Doc must be a single-tab document. DocumentApp
// (the API this script uses) predates Google Docs' "tabs" feature and
// only ever reads the document's first/default tab - any extra tabs are
// silently invisible to this script, not merged in and not an error.
// If the Home Doc currently has more than one tab, move everything you
// want shown into the first tab and delete the rest before relying on
// this page.

const FOLDER_ID = '1SLoKuLQdiew-yB6x-cHpzm3cxyVpUqwi';
const HOME_DOC_ID = '1c25axkB_KaTPaZXksvpXh1FFL-BCOhj-NNyD7vOuOIc';

function doGet() {
  const email = Session.getActiveUser().getEmail();

  if (!email || !isMember(email)) {
    return page(
      '<p>This page is only available to 9A Cambridge St committee members.</p>' +
      '<p>Signed in as: ' + (email || 'nobody') + '</p>'
    );
  }

  try {
    const body = DocumentApp.openById(HOME_DOC_ID).getBody();
    return page(bodyToHtml(body));
  } catch (err) {
    return page(
      '<p>The Home page could not load its content.</p>' +
      '<p>Signed in as: ' + escapeHtml(email) + '</p>' +
      '<p>Error: ' + escapeHtml(err.message) + '</p>' +
      '<p>Ask the secretary to check that the Home Page doc (ID ' + HOME_DOC_ID +
      ') is shared with the committee, and that this script was redeployed ' +
      '(Deploy &gt; Manage deployments &gt; edit &gt; New version) after any recent edit.</p>'
    );
  }
}

function isMember(email) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const people = [folder.getOwner()].concat(folder.getEditors(), folder.getViewers());
  return people
    .filter(function (p) { return p; })
    .some(function (p) { return p.getEmail().toLowerCase() === email.toLowerCase(); });
}

// ---------------- Doc -> HTML ----------------

const HEADING_TAGS = {};
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING1] = 'h1';
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING2] = 'h2';
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING3] = 'h3';
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING4] = 'h4';
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING5] = 'h5';
HEADING_TAGS[DocumentApp.ParagraphHeading.HEADING6] = 'h6';
HEADING_TAGS[DocumentApp.ParagraphHeading.TITLE] = 'h1';
HEADING_TAGS[DocumentApp.ParagraphHeading.SUBTITLE] = 'h2';

function bodyToHtml(body) {
  const parts = [];
  let listTag = null; // 'ul' | 'ol' | null - tracks a run of list items

  const closeList = function () {
    if (listTag) {
      parts.push('</' + listTag + '>');
      listTag = null;
    }
  };

  for (let i = 0; i < body.getNumChildren(); i++) {
    const el = body.getChild(i);
    const type = el.getType();

    if (type === DocumentApp.ElementType.LIST_ITEM) {
      const item = el.asListItem();
      const wantTag = item.getGlyphType() === DocumentApp.GlyphType.NUMBER ? 'ol' : 'ul';
      if (listTag && listTag !== wantTag) closeList();
      if (!listTag) {
        listTag = wantTag;
        parts.push('<' + listTag + '>');
      }
      parts.push('<li>' + inlineToHtml(item) + '</li>');
      continue;
    }

    closeList();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const para = el.asParagraph();
      const text = para.getText();
      const tag = HEADING_TAGS[para.getHeading()];
      if (tag) {
        if (text.trim()) parts.push('<' + tag + '>' + inlineToHtml(para) + '</' + tag + '>');
      } else if (text.trim()) {
        parts.push('<p>' + inlineToHtml(para) + '</p>');
      }
      // Blank paragraphs are just spacing in the Doc - CSS margins on
      // headings/paragraphs already handle that, so they're dropped
      // rather than turned into empty <p> tags.
    }
    // Tables and images aren't handled - the Home page hasn't needed
    // them so far. If that changes, extend this function rather than
    // falling back to the old iframe embed.
  }
  closeList();

  return parts.join('\n');
}

function inlineToHtml(container) {
  const text = container.editAsText();
  const raw = text.getText();
  if (!raw) return '';

  let html = '';
  let i = 0;
  while (i < raw.length) {
    let j = i;
    const bold = text.isBold(i);
    const italic = text.isItalic(i);
    const underline = text.isUnderline(i);
    const url = text.getLinkUrl(i);
    while (
      j < raw.length &&
      text.isBold(j) === bold &&
      text.isItalic(j) === italic &&
      text.isUnderline(j) === underline &&
      text.getLinkUrl(j) === url
    ) {
      j++;
    }

    let run = escapeHtml(raw.slice(i, j));
    if (url) run = '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + run + '</a>';
    if (bold) run = '<strong>' + run + '</strong>';
    if (italic) run = '<em>' + run + '</em>';
    if (underline && !url) run = '<u>' + run + '</u>'; // links already read as underlined
    html += run;

    i = j;
  }
  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function page(bodyHtml) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'max-width:680px;margin:0 auto;padding:20px 16px 48px;line-height:1.5;' +
    'color:#1a1a1a;word-wrap:break-word;}' +
    'h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 0.4em;}' +
    'p{margin:0 0 1em;}' +
    'ul,ol{margin:0 0 1em;padding-left:1.4em;}' +
    'a{color:#1a56db;}' +
    'img{max-width:100%;height:auto;}' +
    '</style></head><body>' + bodyHtml + '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
