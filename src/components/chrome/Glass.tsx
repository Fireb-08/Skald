import type { CSSProperties, MouseEvent, ReactNode } from 'react';

export interface GlassProps {
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  translucent: boolean;
}

export default function Glass({ children, style, onClick, onContextMenu, translucent }: GlassProps) {
  return (
    <div onClick={onClick} onContextMenu={onContextMenu} style={{
      // Static frosted fill — deliberately NO live backdrop-filter. On WebView2 a
      // live backdrop-filter, re-sampled inside the small damage rect of a click
      // (and presented over the transparent window's alpha path), leaves a
      // partial-invalidation "band" that no compositor-level fix removed across
      // five attempts (layer promotion, wash de-blur, scale removal, opaque webview
      // background). A static semi-opaque tint over the OnyxWash keeps the
      // translucent Onyx depth — the wash's ambient accent glow still bleeds
      // through — with ZERO backdrop sampling, so the artifact is structurally
      // impossible. willChange is gone too: the cached layer it created was itself
      // what retained the stale strip until a full repaint.
      //
      // To read as LIT GLASS rather than a flat tint, the fill is a soft diagonal
      // gradient: more see-through (lower alpha) at the top-left "sheen" so the
      // OnyxWash + accent glow bleed through, darkening toward the bottom for depth.
      // Combined with the crisper top-edge inset highlight below, this recovers the
      // translucent look the live blur gave — with zero backdrop sampling. Alphas
      // are the knob: raise for more solidity, lower for more glow bleed-through.
      background: translucent
        ? 'linear-gradient(158deg, rgba(34, 35, 44, 0.46) 0%, rgba(18, 18, 23, 0.60) 100%)'
        : 'var(--onyx-panel)',
      border: '1px solid var(--onyx-glass-edge)',
      borderRadius: 16,
      boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)',
      ...style,
    }}>{children}</div>
  );
}
