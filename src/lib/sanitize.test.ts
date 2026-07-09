// Regression tests for the remote-HTML sanitizer (Testing Suite plan #4).
// These fragments model what a hostile podcast feed or metadata provider could
// put in a description; anything executable must be gone after sanitizing.
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('removes script tags AND their contents', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('alert');
  });

  it('drops event-handler attributes', () => {
    const out = sanitizeHtml('<p onclick="alert(1)" onmouseover="x()">text</p>');
    expect(out).toBe('<p>text</p>');
  });

  it('drops javascript: and data: links but keeps http(s) links', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="https://example.com/ep">x</a>'))
      .toBe('<a href="https://example.com/ep" rel="noopener noreferrer">x</a>');
  });

  it('removes iframes, forms, svg and other dangerous containers with content', () => {
    for (const frag of [
      '<iframe src="https://evil"></iframe>',
      '<form action="https://evil"><input name="q"></form>',
      '<svg><script>alert(1)</script></svg>',
      '<object data="x"></object>',
      '<style>body{display:none}</style>',
    ]) {
      expect(sanitizeHtml(`<p>keep</p>${frag}`)).toBe('<p>keep</p>');
    }
  });

  it('keeps basic formatting and unwraps unknown-but-harmless tags', () => {
    expect(sanitizeHtml('<b>bold</b> <em>em</em><ul><li>one</li></ul>'))
      .toBe('<b>bold</b> <em>em</em><ul><li>one</li></ul>');
    // <font> is not allowlisted but its text must survive (unwrap, not drop).
    expect(sanitizeHtml('<font color="red">text</font>')).toBe('text');
  });

  it('strips all attributes from allowed tags (no style/class smuggling)', () => {
    expect(sanitizeHtml('<p style="position:fixed" class="x" data-y="z">t</p>')).toBe('<p>t</p>');
  });

  it('handles empty and plain-text input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml('plain text')).toBe('plain text');
  });
});
