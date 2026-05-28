import Icon from '../Icon';
import type { IconName } from '../Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface InitialProps {
  name: string;
  icon?: IconName | null;
  small?: boolean;
}

export default function Initial({ name, icon = null, small = false }: InitialProps) {
  const initials = (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const size = small ? 32 : 48;
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, flexShrink: 0,
      background: 'linear-gradient(135deg, rgba(212,166,74,0.25), rgba(212,166,74,0.08))',
      border: '1px solid var(--onyx-glass-edge)',
      color: 'var(--onyx-accent)', fontFamily: SERIF, fontSize: small ? 13 : 18, fontWeight: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {icon ? <Icon name={icon} size={small ? 14 : 18} /> : initials}
    </div>
  );
}
