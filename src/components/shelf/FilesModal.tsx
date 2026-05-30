import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { fetchItem } from '../../api/abs';
import type { LibraryFile } from '../../api/abs';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface FilesModalProps {
  bookId: string;
  serverUrl: string;
  onClose: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000)     return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)         return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function FilesModal({ bookId, serverUrl, onClose }: FilesModalProps) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchItem(serverUrl, bookId)
      .then(item => setFiles(item.libraryFiles ?? []))
      .catch(e => setError(String(e)));
  }, [serverUrl, bookId]);

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
        width: 620,
        maxWidth: '90vw',
        background: 'var(--onyx-panel2)',
        border: '1px solid var(--onyx-line)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '70vh',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: 'var(--onyx-text)' }}>
            Library Files
          </div>
          {files !== null && (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 6,
              color: 'var(--onyx-text-dim)',
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              padding: '5px 12px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {files === null && !error && (
            <div style={{ padding: '24px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: '16px 24px', fontSize: 12, color: '#e8716a' }}>{error}</div>
          )}
          {files !== null && files.length === 0 && (
            <div style={{ padding: '24px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
              No files found.
            </div>
          )}
          {files !== null && files.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--onyx-line)' }}>
                  {(['PATH', 'SIZE', 'TYPE'] as const).map(h => (
                    <th key={h} style={{
                      padding: '8px 24px',
                      fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em',
                      textTransform: 'uppercase', color: 'var(--onyx-text-mute)',
                      fontWeight: 400, textAlign: 'left',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr
                    key={f.ino}
                    style={{ borderBottom: i < files.length - 1 ? '1px solid var(--onyx-line)' : 'none' }}
                  >
                    <td style={{ padding: '10px 24px', fontSize: 12.5, color: 'var(--onyx-text)', fontFamily: MONO, wordBreak: 'break-all' }}>
                      {f.metadata.filename}
                    </td>
                    <td style={{ padding: '10px 24px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)', whiteSpace: 'nowrap' }}>
                      {fmtSize(f.metadata.size)}
                    </td>
                    <td style={{ padding: '10px 24px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      {f.fileType}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
