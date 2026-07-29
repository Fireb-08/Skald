import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Auto-cleanup isn't globally registered here, so unmount between tests to keep
// one test's rendered pill from leaking into the next.
afterEach(cleanup);

// Titlebar imports the Tauri window API at module load for the min/max/close
// buttons — stub it so the component mounts under jsdom.
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ minimize() {}, toggleMaximize() {}, close() {} }),
}));

import Titlebar from './Titlebar';

describe('Titlebar offline retry', () => {
  it('shows the Retry button only when offline and invokes onRetry on click', async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const { rerender } = render(<Titlebar isDark onRetry={onRetry} />);

    // Not offline → no retry affordance.
    expect(screen.queryByText('Retry')).toBeNull();

    // Offline → the pill offers Retry, wired to onRetry.
    rerender(<Titlebar isDark isOffline onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });

  it('omits the Retry button when no onRetry is provided', () => {
    render(<Titlebar isDark isOffline />);
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
