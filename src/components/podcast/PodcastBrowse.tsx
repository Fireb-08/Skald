// Podcast library browse grid. Rendered by Library.tsx when the active library
// is a podcast library. Each tile is a square cover with the podcast title and
// an episode-count badge; clicking opens the podcast detail screen.
import { useState } from 'react';
import type { OnyxState } from '../../state/onyx';
import { asPodcastItem } from '../../api/abs';
import Cover from '../Cover';
import PodcastSubscribeModal from './PodcastSubscribeModal';

export interface PodcastBrowseProps {
  st: OnyxState;
}

export default function PodcastBrowse({ st }: PodcastBrowseProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const [showSubscribe, setShowSubscribe] = useState(false);

  // Apply the shelf search box to podcast titles (TopNav writes st.search).
  const q = st.search.trim().toLowerCase();
  const items = q
    ? st.library.filter(it => (it.media?.metadata?.title ?? '').toLowerCase().includes(q))
    : st.library;

  const open = (id: string) => {
    console.log('[Podcast] open detail', id);
    st.setPodcastDetailId(id);
    st.setScreen('podcast');
  };

  const subscribeBtn = (
    <button
      onClick={() => setShowSubscribe(true)}
      style={{
        padding: '7px 14px', borderRadius: 8, border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer',
        background: 'var(--onyx-accent)', color: 'var(--onyx-bg)',
        fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600,
      }}
    >+ Subscribe</button>
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em' }}>
        {st.library.length} PODCAST{st.library.length === 1 ? '' : 'S'}
      </div>
      <div style={{ flex: 1 }} />
      {subscribeBtn}
    </div>
  );

  const modal = showSubscribe && st.activeLibrary && (
    <PodcastSubscribeModal
      st={st}
      library={st.activeLibrary}
      onClose={() => setShowSubscribe(false)}
      onSubscribed={() => { st.refreshLibrary().catch(e => console.error('[Podcast] refresh after subscribe failed:', e)); }}
    />
  );

  if (st.library.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        {header}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'var(--onyx-text-mute)', fontFamily: mono, fontSize: 13, letterSpacing: '0.06em', gap: 8,
        }}>
          <div>No podcasts in this library yet.</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>Use Subscribe to add one by RSS feed or OPML import.</div>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      {header}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 18,
        alignItems: 'start',
      }}>
        {items.map(it => {
          const p = asPodcastItem(it);
          const title = p.media?.metadata?.title ?? it.id;
          const author = p.media?.metadata?.author ?? '';
          const count = p.media?.numEpisodes ?? p.media?.episodes?.length ?? 0;
          return (
            <button
              key={it.id}
              onClick={() => open(it.id)}
              className="onyx-tile"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'inherit',
              }}
            >
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
                <Cover item={it} fill serverUrl={st.serverUrl} fallbackImageUrl={p.media?.metadata?.imageUrl ?? undefined} />
                {/* Episode-count badge */}
                <div style={{
                  position: 'absolute', right: 6, bottom: 6,
                  background: 'rgba(0,0,0,0.72)', color: 'var(--onyx-text)',
                  fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
                  padding: '2px 6px', borderRadius: 4,
                }}>{count} ep{count === 1 ? '' : 's'}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, color: 'var(--onyx-text)', fontWeight: 600, lineHeight: 1.25,
                  overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>{title}</div>
                {author && (
                  <div style={{
                    fontSize: 11, color: 'var(--onyx-text-dim)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{author}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      </div>
      {modal}
    </div>
  );
}
