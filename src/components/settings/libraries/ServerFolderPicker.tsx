// Modal ABS server-filesystem browser used by the library form's folder rows.
// Moved verbatim out of LibrariesSection.tsx (God-File Decomposition roadmap, L3/L7).
import { useState, useEffect } from 'react';
import { MONO, SERIF } from '../shared';
import { browseServerFilesystem } from '../../../api/abs';
import type { FsEntry } from '../../../api/abs';
import { SmallBtn } from './widgets';

export interface ServerFolderPickerProps {
  serverUrl: string;
  initial: string;          // pre-navigate to this path if non-empty, else "/"
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export default function ServerFolderPicker({ serverUrl, initial, onSelect, onCancel }: ServerFolderPickerProps) {
  const startPath = initial.trim() || '/';
  const [currentPath, setCurrentPath] = useState(startPath);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch whenever the path changes.
  useEffect(() => { void navigate(currentPath); }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function navigate(path: string) {
    setLoading(true);
    setError('');
    try {
      const result = await browseServerFilesystem(serverUrl, path);
      // ABS response has no top-level path field — keep the path we requested.
      setCurrentPath(path);
      setEntries(result.directories.slice().sort((a, b) => a.dirname.localeCompare(b.dirname)));
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to read directory.');
    } finally {
      setLoading(false);
    }
  }

  // Split current path into breadcrumb segments for navigation.
  function breadcrumbs(): { label: string; path: string }[] {
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      crumbs.push({ label: part, path: accumulated });
    }
    return crumbs;
  }

  // Parent path: strip the last segment.
  function parentPath(): string {
    const norm = currentPath.replace(/\\/g, '/').replace(/\/$/, '');
    const idx = norm.lastIndexOf('/');
    return idx <= 0 ? '/' : norm.slice(0, idx);
  }

  const crumbs = breadcrumbs();
  const canGoUp = currentPath !== '/' && currentPath !== '';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: 540, maxWidth: '92vw', maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--onyx-panel2)',
        backdropFilter: 'blur(40px) saturate(120%)',
        WebkitBackdropFilter: 'blur(40px) saturate(120%)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--onyx-line)',
          flexShrink: 0,
        }}>
          <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 10 }}>
            Select Server Folder
          </div>

          {/* Breadcrumb strip */}
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 0',
            fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.03em',
            background: 'rgba(0,0,0,0.25)', borderRadius: 6,
            padding: '6px 10px', minHeight: 30,
          }}>
            {crumbs.map((crumb, i) => (
              <span key={crumb.path} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: 'var(--onyx-text-mute)', margin: '0 2px' }}>/</span>}
                <button
                  onClick={() => setCurrentPath(crumb.path)}
                  style={{
                    background: 'none', border: 'none', padding: '1px 3px',
                    borderRadius: 3, cursor: 'pointer', fontFamily: MONO, fontSize: 10.5,
                    color: i === crumbs.length - 1 ? 'var(--onyx-text)' : 'var(--onyx-accent)',
                    fontWeight: i === crumbs.length - 1 ? 500 : 400,
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Directory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {loading && (
            <div style={{ padding: '20px 12px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Loading…
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: '12px', fontFamily: MONO, fontSize: 11, color: '#e8716a' }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Up / parent row */}
              {canGoUp && (
                <button
                  onClick={() => setCurrentPath(parentPath())}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'transparent', border: 'none',
                    color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 12,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 14 }}>↑</span>
                  <span style={{ letterSpacing: '0.02em' }}>..</span>
                </button>
              )}

              {entries.length === 0 && (
                <div style={{ padding: '12px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.05em' }}>
                  No subdirectories
                </div>
              )}

              {entries.map(entry => (
                <button
                  key={entry.path}
                  onClick={() => setCurrentPath(entry.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'transparent', border: 'none',
                    color: 'var(--onyx-text)', fontFamily: 'inherit', fontSize: 13,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 14, flexShrink: 0 }}>📁</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.dirname}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer: current selection + action buttons */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--onyx-line)',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{
            fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)',
            letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {currentPath}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <SmallBtn muted onClick={onCancel}>Cancel</SmallBtn>
            <SmallBtn onClick={() => onSelect(currentPath)} disabled={loading}>
              Select This Folder
            </SmallBtn>
          </div>
        </div>
      </div>
    </div>
  );
}
