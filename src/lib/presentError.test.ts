import { describe, expect, it } from 'vitest';
import { presentError } from './presentError';

describe('presentError', () => {
  it.each([
    ['request timed out for https://secret.example/api?token=secret', 'unreachable'],
    ['certificate verify failed: unknown issuer', 'tls'],
    ['server returned 401 with <html>secret body</html>', 'unauthorized'],
    ['403 Forbidden', 'forbidden'], ['409 duplicate item', 'conflict'],
    ['No space left on device', 'capacity'],
  ] as const)('classifies technical errors without echoing raw detail', (raw, kind) => {
    const result = presentError(raw, { operation: 'authenticate', credential: 'api-key' });
    expect(result.kind).toBe(kind);
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(JSON.stringify(result)).not.toContain('secret.example');
    expect(JSON.stringify(result)).not.toContain('<html>');
  });

  it('gives API-key failures a WebUI recovery action', () => {
    const result = presentError('Invalid API key — server returned 401', { operation: 'authenticate', credential: 'api-key' });
    expect(result.action).toContain('Audiobookshelf WebUI');
  });

  it('uses safe generic copy for arbitrary response objects', () => {
    const result = presentError({ response: '<script>unsafe()</script>' }, { operation: 'save' });
    expect(result.kind).toBe('unexpected');
    expect(JSON.stringify(result)).not.toContain('unsafe');
  });
});
