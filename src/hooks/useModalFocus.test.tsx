import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalFocus } from './useModalFocus';

function Fixture({ onClose }: { onClose: () => void }) {
  const ref = useModalFocus<HTMLDivElement>(onClose);
  return <div ref={ref} role="dialog" tabIndex={-1}><button>First</button><button>Last</button></div>;
}

function NamedFixture({ name, onClose }: { name: string; onClose: () => void }) {
  const ref = useModalFocus<HTMLDivElement>(onClose);
  return <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}><button>{name} first</button><button>{name} last</button></div>;
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

  it('gives Tab and Escape only to the topmost nested modal', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    render(<><NamedFixture name="Parent" onClose={closeParent} /><NamedFixture name="Confirmation" onClose={closeChild} /></>);

    screen.getByRole('button', { name: 'Parent last' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirmation first' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeChild).toHaveBeenCalledOnce();
    expect(closeParent).not.toHaveBeenCalled();
  });
});
