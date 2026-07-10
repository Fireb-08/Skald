export type ErrorKind = 'unreachable' | 'tls' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'capacity' | 'validation' | 'offline-queued' | 'unexpected';

export interface PresentedError {
  kind: ErrorKind;
  title: string;
  message: string;
  action?: string;
  showLogHint: boolean;
}

export interface ErrorPresentationContext {
  operation?: 'authenticate' | 'download' | 'save' | 'import' | 'refresh';
  credential?: 'api-key' | 'password' | 'saved-session';
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '';
}

/** Translate technical failures without returning raw response text to the UI. */
export function presentError(error: unknown, context: ErrorPresentationContext = {}): PresentedError {
  const raw = errorText(error).toLowerCase();
  const authentication = context.operation === 'authenticate';
  if (/certificate|cert |tls|ssl|unknown issuer|invalid peer/.test(raw)) return { kind: 'tls', title: 'Secure connection failed', message: 'Skald could not verify the server certificate.', action: 'Check the HTTPS address or certificate, then try again.', showLogHint: true };
  if (/401|unauthori[sz]ed|invalid (api )?key|invalid credentials|incorrect password|authentication failed/.test(raw)) {
    const credential = context.credential === 'api-key' ? 'API key' : context.credential === 'saved-session' ? 'saved sign-in' : 'username and password';
    return { kind: 'unauthorized', title: 'Sign-in was not accepted', message: `The server did not accept your ${credential}.`, action: context.credential === 'api-key' ? 'Create or copy a valid key from the Audiobookshelf WebUI, then try again.' : 'Check your credentials and try again.', showLogHint: false };
  }
  if (/403|forbidden|permission denied|not permitted/.test(raw)) return { kind: 'forbidden', title: 'Permission required', message: authentication ? 'This account is not allowed to sign in here.' : 'Your account is not allowed to complete this action.', action: 'Ask your Audiobookshelf administrator to review your access.', showLogHint: false };
  if (/404|not found/.test(raw)) return { kind: 'not-found', title: authentication ? 'Audiobookshelf was not found' : 'Item not found', message: authentication ? 'The address responded, but it does not appear to be an Audiobookshelf server.' : 'The requested item is no longer available.', action: authentication ? 'Check the server address, port, and reverse-proxy path.' : 'Refresh and try again.', showLogHint: true };
  if (/409|conflict|already exists|duplicate/.test(raw)) return { kind: 'conflict', title: 'That change conflicts with existing data', message: 'Skald could not apply the change because a matching item already exists.', action: 'Review the existing item and try a different value.', showLogHint: false };
  if (/no space|disk full|insufficient (disk|space|storage)|not enough (disk|space|storage)|capacity/.test(raw)) return { kind: 'capacity', title: 'Not enough storage space', message: 'The selected drive does not have enough free space to complete this action.', action: 'Free some space or choose another location, then retry.', showLogHint: false };
  if (/offline.*queue|queued.*offline/.test(raw)) return { kind: 'offline-queued', title: 'Saved for later', message: 'The change is queued and will sync when the server is reachable.', showLogHint: false };
  if (/invalid|validation|required|must be|unsupported|bad request|400/.test(raw)) return { kind: 'validation', title: 'Check the information entered', message: 'One or more values could not be accepted.', action: 'Review the information and try again.', showLogHint: false };
  if (/dns|resolve|connection refused|connect error|failed to connect|network|timed? out|timeout|unreachable|could not connect|error sending request/.test(raw)) return { kind: 'unreachable', title: 'Could not reach the server', message: 'Skald could not connect to that address.', action: 'Check the address, port, network, and whether Audiobookshelf is running.', showLogHint: true };
  return { kind: 'unexpected', title: 'Something went wrong', message: authentication ? 'Skald could not complete sign-in.' : 'Skald could not complete that action.', action: 'Try again. If the problem continues, review Settings → Logs.', showLogHint: true };
}

export function errorMessage(error: unknown, context: ErrorPresentationContext = {}): string {
  const presented = presentError(error, context);
  return [presented.message, presented.action].filter(Boolean).join(' ');
}
