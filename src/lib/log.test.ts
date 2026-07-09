// Regression tests for log redaction (Testing Suite plan #3): tokens must be
// masked whether they arrive as secret-named KEYS or embedded inside string
// VALUES (media-URL errors under `err`, raw JWTs in messages).
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The logger forwards to @tauri-apps/plugin-log — silence it; assertions read
// the in-memory ring buffer instead.
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}),
  attachConsole: vi.fn(async () => () => {}),
}));

import { log, getLogBuffer, clearLogBuffer } from './log';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM';

function lastLine(): string {
  const buf = getLogBuffer();
  return buf[buf.length - 1]!.msg;
}

beforeEach(() => clearLogBuffer());

describe('log redaction', () => {
  it('masks secret-named keys in context objects', () => {
    log.info('auth', 'login ok', { token: 'supersecret', username: 'sam' });
    expect(lastLine()).not.toContain('supersecret');
    expect(lastLine()).toContain('***');
    expect(lastLine()).toContain('sam');
  });

  it('masks token query params embedded in string values under innocent keys', () => {
    // The exact failure shape from the 2nd-pass review: a LibVLC error quoting
    // a media URL, logged as { err: String(e) }.
    log.error('playback', 'load failed', {
      err: `Failed to create media from URL: https://abs.host/track.m4b?token=${JWT}`,
    });
    expect(lastLine()).not.toContain(JWT);
    expect(lastLine()).toContain('https://abs.host/track.m4b?token=***');
  });

  it('masks raw JWTs anywhere in a string, even without a query-param shape', () => {
    log.warn('sync', 'socket said', { detail: `bearer ${JWT} rejected` });
    expect(lastLine()).not.toContain(JWT);
  });

  it('scrubs the message text itself, not only the context', () => {
    log.error('playback', `direct interpolation https://h/x?token=${JWT}`);
    expect(lastLine()).not.toContain(JWT);
  });

  it('masks nested and array-borne secrets', () => {
    log.info('library', 'batch', { items: [{ apiKey: 'k123' }, { url: 'https://h/f.xml?auth=abc123' }] });
    expect(lastLine()).not.toContain('k123');
    expect(lastLine()).not.toContain('abc123');
  });

  it('leaves ordinary content untouched', () => {
    log.info('library', 'scan done', { count: 42, path: 'D:/Audiobooks' });
    expect(lastLine()).toContain('42');
    expect(lastLine()).toContain('D:/Audiobooks');
  });
});
