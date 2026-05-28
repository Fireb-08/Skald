import type { ReactNode } from 'react';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface SectionProps {
  title: string;
  children: ReactNode;
}

export default function Section({ title, children }: SectionProps) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 12, padding: '0 4px' }}>{title}</div>
      {children}
    </div>
  );
}
