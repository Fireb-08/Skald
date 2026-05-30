export interface OnyxWashProps {
  isDark: boolean;
}

export default function OnyxWash({ isDark }: OnyxWashProps) {
  // Build an accent rgba string using CSS custom properties so the gradient
  // re-resolves automatically when --onyx-accent-r/g/b change on :root,
  // without requiring a React re-render of this component.
  const a = (opacity: number) =>
    `rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),${opacity})`;

  if (!isDark) {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--onyx-bg)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: `radial-gradient(50% 50% at 50% 50%, ${a(0.10)}, transparent 65%)`, filter: 'blur(90px)' }} />
        <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: `radial-gradient(50% 50% at 50% 50%, ${a(0.06)}, transparent 60%)`, filter: 'blur(110px)' }} />
        <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(220,200,160,0.35), transparent 65%)', filter: 'blur(120px)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04, mixBlendMode: 'multiply',
          backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(60,40,20,0.5) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(60,40,20,0.45) 0 0.5px, transparent 0.5px 3px)',
        }} />
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--onyx-bg)', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: `radial-gradient(50% 50% at 50% 50%, ${a(0.14)}, transparent 65%)`, filter: 'blur(90px)' }} />
      <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: `radial-gradient(50% 50% at 50% 50%, ${a(0.08)}, transparent 60%)`, filter: 'blur(110px)' }} />
      <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(60,40,20,0.6), transparent 65%)', filter: 'blur(120px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55))' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, mixBlendMode: 'overlay',
        backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(255,255,255,0.6) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(255,255,255,0.5) 0 0.5px, transparent 0.5px 3px)',
      }} />
    </div>
  );
}
