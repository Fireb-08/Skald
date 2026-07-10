import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActivityCenter from './ActivityCenter';
import type { OnyxState } from '../state/onyx';

afterEach(cleanup);

describe('ActivityCenter', () => {
  it('shows newest activity and supports clear and Escape focus return', () => {
    const clearActivity = vi.fn();
    const st = {
      activity: [
        { id: 'new', timestamp: Date.now(), category: 'downloads', outcome: 'error', message: 'Download failed' },
        { id: 'old', timestamp: Date.now() - 60_000, category: 'sync', outcome: 'success', message: 'Sync restored' },
      ],
      clearActivity,
    } as unknown as OnyxState;
    render(<ActivityCenter st={st} />);

    const trigger = screen.getByRole('button', { name: 'Recent activity, 2 items' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Recent activity' })).toBeTruthy();
    expect(screen.getAllByText(/Download failed|Sync restored/).map(node => node.textContent)).toEqual(['Download failed', 'Sync restored']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clearActivity).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
