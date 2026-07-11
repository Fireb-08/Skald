import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));
vi.mock('../LocalImportDialog', () => ({ default: () => null }));
vi.mock('../UploadModal', () => ({ default: () => null }));

import TopNav from './TopNav';
import type { Library } from '../../api/abs';
import type { OnyxState } from '../../state/onyx';

const library = (id: string, name: string): Library => ({
  id, name, mediaType: 'book', source: undefined, icon: null, provider: null,
  displayOrder: null, folders: [], settings: null, lastScan: null,
  createdAt: null, lastUpdate: null,
});

function state(): OnyxState {
  const libraries = [library('one', 'One'), library('two', 'Two')];
  return {
    translucent: false,
    activeLibrary: libraries[0],
    libraries,
    currentLibraryId: 'one',
    screen: 'library',
    library: [],
    search: '',
    searchScope: 'all',
    canUpload: false,
    user: { username: 'listener' },
    localDisplayName: '',
    setScreen: vi.fn(),
    setActiveLibrary: vi.fn(async () => {}),
    setSearch: vi.fn(),
    setSearchScope: vi.fn(),
    setContextFilter: vi.fn(),
    setShelfTab: vi.fn(),
    setSettingsSection: vi.fn(),
  } as unknown as OnyxState;
}

afterEach(cleanup);

describe('TopNav selector accessibility', () => {
  it('exposes the library trigger and listbox relationship', () => {
    render(<TopNav st={state()} />);

    const trigger = screen.getByTitle('Switch library');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Choose library' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('moves through library options and returns focus on Escape', () => {
    render(<TopNav st={state()} />);
    const trigger = screen.getByTitle('Switch library');
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');

    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(options[1], { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Choose library' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('switches libraries without erasing the source library search', () => {
    const st = state();
    render(<TopNav st={st} />);
    fireEvent.click(screen.getByTitle('Switch library'));
    fireEvent.click(screen.getByRole('option', { name: /Two/ }));

    expect(st.setActiveLibrary).toHaveBeenCalledWith('two');
    expect(st.setSearch).not.toHaveBeenCalled();
  });

  it('marks the search-scope selection and supports Home and End', () => {
    render(<TopNav st={state()} />);
    const trigger = screen.getByRole('button', { name: 'Search field scope' });
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Search field scope' });
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0].getAttribute('aria-selected')).toBe('true');
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'End' });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(options[options.length - 1], { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
  });
});
