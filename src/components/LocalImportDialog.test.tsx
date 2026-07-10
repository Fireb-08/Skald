// Journey-level tests for the shared local-import dialog (review H2). The same
// component is mounted from onboarding (AddBooksStep), the main shell (TopNav),
// and Settings (LocalLibrarySection) — these tests pin the shared contract every
// entry point relies on: the three import routes render, a successful import
// reports its counts and refreshes the right library, and quarantined books are
// reported as needing attention instead of silently filed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return handlers.get(cmd)?.(args);
    },
  };
});
const dialog = vi.hoisted(() => ({ open: vi.fn<() => Promise<unknown>>() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialog.open }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import LocalImportDialog from './LocalImportDialog';
import type { OnyxState } from '../state/onyx';
import type { Library, IngestOutcome } from '../api/abs';

const LIBRARY: Library = {
  id: 'local-lib', name: 'On this PC', mediaType: 'book', source: 'local',
  icon: null, provider: null, displayOrder: null, folders: [], settings: null,
  lastScan: null, createdAt: null, lastUpdate: null,
};

const filed = (title: string): IngestOutcome =>
  ({ title, outcome: 'filed', targetPath: `C:/lib/${title}`, message: '' });
const quarantined = (title: string): IngestOutcome =>
  ({ title, outcome: 'quarantined', targetPath: `C:/lib/_Unidentified/${title}`, message: '' });

// A minimal OnyxState slice — only what the dialog touches. Cast through
// unknown because the full state surface is irrelevant to this journey.
function fakeState(currentLibraryId: string) {
  const st = {
    currentLibraryId,
    setActiveLibrary: vi.fn(async () => {}),
    refreshLibrary: vi.fn(async () => {}),
    setToast: vi.fn(),
  };
  return { st, asOnyx: st as unknown as OnyxState };
}

beforeEach(() => {
  cleanup();
  tauri.calls.length = 0;
  tauri.handlers.clear();
  dialog.open.mockReset();
});

describe('shared local import dialog', () => {
  it('offers the same three import routes to every entry point', () => {
    const { asOnyx } = fakeState('elsewhere');
    render(<LocalImportDialog st={asOnyx} library={LIBRARY} onClose={() => {}} />);

    expect(screen.getByText('Add books to “On this PC”')).toBeTruthy();
    expect(screen.getByText('Add files')).toBeTruthy();
    expect(screen.getByText('Add folder')).toBeTruthy();
    expect(screen.getByText('Open Staging')).toBeTruthy();
    expect(screen.getByText('What happens to your files')).toBeTruthy();
    expect(screen.getByText(/Copy and keep originals/)).toBeTruthy();
  });

  it('imports picked files, reports the added count, and refreshes the active library in place', async () => {
    dialog.open.mockResolvedValue(['C:/in/book.m4b']);
    tauri.handlers.set('ingest_local_paths', () => [filed('Book')]);
    // Opened from a host where the target library IS the active one (e.g.
    // Settings → On this PC): the shelf refreshes via setActiveLibrary.
    const { st, asOnyx } = fakeState(LIBRARY.id);
    const onClose = vi.fn();
    render(<LocalImportDialog st={asOnyx} library={LIBRARY} onClose={onClose} />);

    fireEvent.click(screen.getByText('Add files'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(tauri.calls.find(c => c.cmd === 'ingest_local_paths')?.args).toMatchObject({
      libraryId: LIBRARY.id, sources: ['C:/in/book.m4b'],
    });
    expect(st.setToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('1 added'), type: 'success',
    }));
    await waitFor(() => expect(st.setActiveLibrary).toHaveBeenCalledWith(LIBRARY.id));
    expect(st.refreshLibrary).not.toHaveBeenCalled();
  });

  it('refreshes the library list instead when opened from a different active library', async () => {
    dialog.open.mockResolvedValue(['C:/in/book.m4b']);
    tauri.handlers.set('ingest_local_paths', () => [filed('Book')]);
    // Opened from a host where another library is active (e.g. TopNav on the
    // ABS shelf, or onboarding): the import must not steal the active shelf.
    const { st, asOnyx } = fakeState('abs-lib');
    const onClose = vi.fn();
    render(<LocalImportDialog st={asOnyx} library={LIBRARY} onClose={onClose} />);

    fireEvent.click(screen.getByText('Add files'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(st.refreshLibrary).toHaveBeenCalled());
    expect(st.setActiveLibrary).not.toHaveBeenCalled();
  });

  it('reports quarantined books as needing attention, not as silently added', async () => {
    dialog.open.mockResolvedValue('C:/in/folder'); // folder route returns a single path
    tauri.handlers.set('ingest_local_paths', () => [filed('Known'), quarantined('Mystery')]);
    // No quarantine queue rows match → the match flow is skipped and the
    // needs-attention count flows straight into the summary toast.
    tauri.handlers.set('get_unidentified_items', () => []);
    const { st, asOnyx } = fakeState('elsewhere');
    const onClose = vi.fn();
    render(<LocalImportDialog st={asOnyx} library={LIBRARY} onClose={onClose} />);

    fireEvent.click(screen.getByText('Add folder'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(st.setToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('1 added, 1 need attention'), type: 'success',
    }));
  });

  it('surfaces an import failure without closing the dialog', async () => {
    dialog.open.mockResolvedValue(['C:/in/book.m4b']);
    tauri.handlers.set('ingest_local_paths', () => { throw new Error('disk full'); });
    const { st, asOnyx } = fakeState('elsewhere');
    const onClose = vi.fn();
    render(<LocalImportDialog st={asOnyx} library={LIBRARY} onClose={onClose} />);

    fireEvent.click(screen.getByText('Add files'));

    await waitFor(() => expect(screen.getByText(/Could not import/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(st.setToast).not.toHaveBeenCalled();
  });
});
