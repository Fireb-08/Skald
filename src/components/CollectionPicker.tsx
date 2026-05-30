import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem } from '../state/onyx';
import { getCollections, addBookToCollection } from '../api/abs';
import type { Collection } from '../api/abs';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface CollectionPickerProps {
  item: LibraryItem;
  serverUrl: string;
  onClose: () => void;
}

export default function CollectionPicker({ item, serverUrl, onClose }: CollectionPickerProps) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getCollections(serverUrl, item.libraryId)
      .then(setCollections)
      .catch(e => setError(String(e)));
  }, [serverUrl, item.libraryId]);

  async function handleAdd(col: Collection) {
    setAdding(col.id);
    try {
      await addBookToCollection(serverUrl, col.id, item.id);
      onClose();
    } catch (e) {
      setError(String(e));
      setAdding(null);
    }
  }

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 340,
        background: 'var(--onyx-panel2)',
        border: '1px solid var(--onyx-line)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        padding: '20px 0 8px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '60vh',
      }}>
        {/* Header */}
        <div style={{ padding: '0 20px 14px', borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: 'var(--onyx-text)' }}>
            Add to Collection
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 4, letterSpacing: '0.04em' }}>
            Choose a collection for this book
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {collections === null && !error && (
            <div style={{ padding: '16px 20px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: '12px 20px', fontSize: 12, color: '#e8716a' }}>{error}</div>
          )}
          {collections !== null && collections.length === 0 && (
            <div style={{ padding: '12px 20px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
              No collections
            </div>
          )}
          {collections?.map(col => (
            <button
              key={col.id}
              disabled={adding !== null}
              onClick={() => handleAdd(col)}
              style={{
                display: 'block', width: '100%',
                padding: '10px 20px',
                background: adding === col.id ? 'var(--onyx-accent-dim)' : 'transparent',
                border: 'none',
                color: adding === col.id ? 'var(--onyx-accent)' : 'var(--onyx-text)',
                fontSize: 13.5, textAlign: 'left',
                cursor: adding !== null ? 'default' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.1s',
              }}
            >
              {adding === col.id ? 'Adding…' : col.name}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 20px 4px', borderTop: '1px solid var(--onyx-line)' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 6,
              color: 'var(--onyx-text-dim)',
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
