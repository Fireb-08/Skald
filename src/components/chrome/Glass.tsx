import type { CSSProperties, ReactNode } from 'react';

export interface GlassProps {
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  translucent: boolean;
}

export default function Glass({ children, style, onClick, translucent }: GlassProps) {
  return (
    <div onClick={onClick} style={{
      background: translucent ? 'var(--onyx-glass)' : 'var(--onyx-panel)',
      backdropFilter: translucent ? 'blur(40px) saturate(120%)' : 'none',
      WebkitBackdropFilter: translucent ? 'blur(40px) saturate(120%)' : 'none',
      border: '1px solid var(--onyx-glass-edge)',
      borderRadius: 16,
      boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      ...style,
    }}>{children}</div>
  );
}
