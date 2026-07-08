// Allowlist HTML sanitizer for remote-origin rich text — book synopses from
// ABS metadata providers and podcast episode descriptions from arbitrary RSS
// feeds. These strings are rendered via dangerouslySetInnerHTML, so without
// sanitizing, a hostile feed could inject markup that executes in the WebView.
//
// Approach: DOMParser produces an *inert* document (scripts and event handlers
// never execute during parsing); the tree is then rebuilt keeping only basic
// formatting tags and http(s) links. Everything else — attributes, inline
// styles, event handlers, embeds — is dropped. Unknown-but-harmless tags are
// unwrapped (their text survives); actively dangerous containers are removed
// with their content.

// Formatting tags preserved as-is (attribute-free, except <a href>).
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'span', 'a',
]);

// Tags whose CONTENT must also be discarded — unwrapping these would leak
// script text or nested markup that was never meant to render.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'svg', 'math', 'form', 'input', 'button', 'textarea', 'select',
  'audio', 'video', 'source', 'link', 'meta', 'base', 'title', 'head',
]);

/** True when an anchor href is a plain web link (no javascript:/data:/etc.). */
function safeHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** Recursively copy `node` into `parent`, keeping only allowlisted content. */
function appendSanitized(parent: Element, node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.textContent ?? ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // comments, CDATA, etc.

  const tag = (node as Element).tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return;

  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown formatting wrapper (<font>, <center>, <table>…) — unwrap so the
    // text content still renders, just without the unsupported styling.
    for (const child of Array.from(node.childNodes)) appendSanitized(parent, child);
    return;
  }

  const el = document.createElement(tag);
  if (tag === 'a') {
    const href = (node as Element).getAttribute('href') ?? '';
    if (safeHref(href)) {
      el.setAttribute('href', href);
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const child of Array.from(node.childNodes)) appendSanitized(el, child);
  parent.appendChild(el);
}

/** Sanitize an untrusted HTML fragment down to basic formatting + web links. */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');
  for (const child of Array.from(doc.body.childNodes)) appendSanitized(container, child);
  return container.innerHTML;
}
