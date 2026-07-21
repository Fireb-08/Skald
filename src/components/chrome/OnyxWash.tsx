export interface OnyxWashProps {
  isDark: boolean;
}

// WebView2 partial-repaint mitigation, stage 2 (see Glass.tsx for stage 1):
// the wash originally soft-lit the window with radial gradients under a
// filter: blur(90-120px). Runtime filters are re-rastered inside damage rects
// with output that doesn't quite match the surrounding full pass — a frozen
// full-height "band" over/through the translucent panels. Layer promotion
// alone didn't cure it, so the blur is gone entirely: the same softness is
// baked into multi-stop gradient falloffs, which rasterize deterministically
// (and skip a large GPU filter pass). Falloff stops approximate the gaussian
// tail the blur used to add past the old hard `transparent 60-65%` stop.
const glow = (a: (o: number) => string, peak: number) =>
  `radial-gradient(50% 50% at 50% 50%, ${a(peak)} 0%, ${a(peak * 0.6)} 35%, ${a(peak * 0.25)} 58%, transparent 80%)`;

export default function OnyxWash({ isDark }: OnyxWashProps) {
  // Build an accent rgba string using CSS custom properties so the gradient
  // re-resolves automatically when --onyx-accent-r/g/b change on :root,
  // without requiring a React re-render of this component.
  const a = (opacity: number) =>
    `rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),${opacity})`;

  if (!isDark) {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--onyx-bg)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: glow(a, 0.10) }} />
        <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: glow(a, 0.06) }} />
        <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: glow(a, 0.10) }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04, mixBlendMode: 'multiply',
          backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(60,40,20,0.5) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(60,40,20,0.45) 0 0.5px, transparent 0.5px 3px)',
        }} />
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--onyx-bg)', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: glow(a, 0.14) }} />
      <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: glow(a, 0.08) }} />
      <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: glow(a, 0.12) }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55))' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, mixBlendMode: 'overlay',
        backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(255,255,255,0.6) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(255,255,255,0.5) 0 0.5px, transparent 0.5px 3px)',
      }} />
    </div>
  );
}
