import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Toast from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast accessibility contract', () => {
  it('announces errors assertively and gives dismissal an accessible name', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Connection failed" type="error" onDismiss={onDismiss} />);

    const toast = screen.getByRole('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
    expect(toast.getAttribute('aria-atomic')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each(['success', 'info'] as const)('announces %s messages politely', (type) => {
    render(<Toast message="Library updated" type={type} onDismiss={() => {}} />);

    const toast = screen.getByRole('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.textContent).toContain('Library updated');
  });

  it('dismisses automatically after the existing display interval', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Saved" type="success" onDismiss={onDismiss} />);

    vi.advanceTimersByTime(4_000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
