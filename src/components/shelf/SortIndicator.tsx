export interface SortIndicatorProps {
  active: boolean;
  dir: 'asc' | 'desc';
}

export default function SortIndicator({ active, dir }: SortIndicatorProps) {
  return (
    <svg width="9" height="11" viewBox="0 0 9 11" style={{ flexShrink: 0, opacity: active ? 1 : 0.25 }}>
      <path d="M4.5 1 L1 5 L8 5 Z" fill={active && dir === 'asc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
      <path d="M4.5 10 L1 6 L8 6 Z" fill={active && dir === 'desc' ? 'currentColor' : 'rgba(235,231,223,0.3)'} />
    </svg>
  );
}
