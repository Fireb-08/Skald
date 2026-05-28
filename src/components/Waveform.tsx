export interface WaveformProps {
  width?: number;
  height?: number;
  progress?: number;
  color?: string;
  dim?: string;
  bars?: number;
  seed?: number;
  flat?: boolean;
}

export default function Waveform({
  width = 600,
  height = 80,
  progress = 0.42,
  color = '#fff',
  dim = 'rgba(255,255,255,0.22)',
  bars = 110,
  seed = 7,
  flat = false,
}: WaveformProps) {
  const arr: number[] = [];
  let s = seed;
  for (let i = 0; i < bars; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    if (flat) {
      arr.push(height);
      continue;
    }
    const env = 0.35 + 0.55 * Math.abs(Math.sin((i / bars) * Math.PI * 2.2)) + 0.18 * Math.sin(i / 3);
    const h = Math.max(2, Math.min(1, env + (r - 0.5) * 0.55) * height);
    arr.push(h);
  }
  const barW = width / bars;
  const playedTo = Math.floor(bars * progress);
  return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', gap: 0 }}>
      {arr.map((h, i) => (
        <div
          key={i}
          style={{
            width: barW - 1,
            height: h,
            marginRight: 1,
            background: i < playedTo ? color : dim,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}
