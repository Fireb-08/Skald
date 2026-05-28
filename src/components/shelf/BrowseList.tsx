import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import Icon from '../Icon';
import SortIndicator from './SortIndicator';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface BrowseColumn {
  id: string;
  label: string;
  flex?: number;
  width?: number;
}

export interface BrowseRow {
  key: string;
  onClick: () => void;
  leading: ReactNode;
  sort: Record<string, string | number>;
  cells: Record<string, ReactNode>;
}

export interface BrowseListProps {
  columns: BrowseColumn[];
  rows: BrowseRow[];
}

export default function BrowseList({ columns, rows }: BrowseListProps) {
  const [sortBy, setSortBy] = useState({ col: columns[0]?.id ?? '', dir: 'asc' as 'asc' | 'desc' });
  const colSizes = columns.map(c => c.width ? `${c.width}px` : `${c.flex ?? 1}fr`).join(' ');
  const grid = `48px ${colSizes} 16px`;

  const onHeader = (id: string) => {
    if (sortBy.col === id) {
      setSortBy({ col: id, dir: sortBy.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortBy({ col: id, dir: 'asc' });
    }
  };

  const sorted = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const av = a.sort?.[sortBy.col];
      const bv = b.sort?.[sortBy.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortBy.dir === 'asc' ? av - bv : bv - av;
      return sortBy.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return out;
  }, [rows, sortBy.col, sortBy.dir]);

  return (
    <div style={{ background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 16,
        padding: '12px 16px', borderBottom: '1px solid var(--onyx-line)',
        background: 'rgba(0,0,0,0.18)',
      }}>
        <div />
        {columns.map(c => {
          const active = sortBy.col === c.id;
          return (
            <button key={c.id} onClick={() => onHeader(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
              textAlign: 'left',
            }}>
              {c.label}
              <SortIndicator active={active} dir={sortBy.dir} />
            </button>
          );
        })}
        <div />
      </div>
      {sorted.map((r, i) => (
        <button key={r.key} onClick={r.onClick} style={{
          display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 16,
          padding: '10px 16px', width: '100%', textAlign: 'left',
          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
          border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--onyx-line)',
          cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
        }} className="onyx-row">
          {r.leading}
          {columns.map(c => <div key={c.id} style={{ minWidth: 0 }}>{r.cells[c.id]}</div>)}
          <span style={{ color: 'var(--onyx-text-mute)', opacity: 0.5, display: 'inline-flex' }}>
            <Icon name="chevron-right" size={11} />
          </span>
        </button>
      ))}
    </div>
  );
}
