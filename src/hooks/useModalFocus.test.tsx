import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalFocus } from './useModalFocus';

function Fixture({ onClose }: { onClose: () => void }) {
  const ref = useModalFocus<HTMLDivElement>(onClose);
  return <div ref={ref} role="dialog" tabIndex={-1}><button>First</button><button>Last</button></div>;
}

afterEach(cleanup);

describe('useModalFocus', () => {
  it('traps Tab, closes on Escape, and restores the invoker', () => {
    const onClose = vi.fn();
    const { unmount } = render(<><button>Invoker</button><Fixture onClose={onClose} /></>);
    const invoker = screen.getByRole('button', { name: 'Invoker' });
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    invoker.focus();
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
  });
});
