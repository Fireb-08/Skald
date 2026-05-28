// Onyx — shared icon set. SVG strokes so they crisp at any zoom.
// Pass color via currentColor.
function Icon({ name, size = 16, style }) {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style };
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const fill = { fill: 'currentColor' };
  switch (name) {
    case 'play':
      return <svg style={s} viewBox="0 0 16 16"><path d="M4 3 L13 8 L4 13 Z" {...fill} /></svg>;
    case 'pause':
      return <svg style={s} viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" rx="0.5" {...fill} /><rect x="9" y="3" width="3" height="10" rx="0.5" {...fill} /></svg>;
    case 'skip-back':
      // Double-chevron pointing LEFT with "30" label — unambiguous "jump back 30 seconds."
      return <svg style={s} viewBox="0 0 24 24"><path d="M 9 7 L 4 12 L 9 17" {...stroke} /><path d="M 14 7 L 9 12 L 14 17" {...stroke} /><text x="20" y="15" fontSize="7" fontFamily="ui-monospace, monospace" fontWeight="600" textAnchor="middle" fill="currentColor">30</text></svg>;
    case 'skip-forward':
      // Double-chevron pointing RIGHT with "30" label — mirror of skip-back.
      return <svg style={s} viewBox="0 0 24 24"><text x="4" y="15" fontSize="7" fontFamily="ui-monospace, monospace" fontWeight="600" textAnchor="middle" fill="currentColor">30</text><path d="M 10 7 L 15 12 L 10 17" {...stroke} /><path d="M 15 7 L 20 12 L 15 17" {...stroke} /></svg>;
    case 'prev-chapter':
      return <svg style={s} viewBox="0 0 16 16"><path d="M5 3 L5 13 M14 3 L5 8 L14 13 Z" {...stroke} /></svg>;
    case 'next-chapter':
      return <svg style={s} viewBox="0 0 16 16"><path d="M11 3 L11 13 M2 3 L11 8 L2 13 Z" {...stroke} /></svg>;
    case 'volume':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 6 L5 6 L9 3 L9 13 L5 10 L2 10 Z" {...stroke} /><path d="M11 6 Q12.5 8 11 10" {...stroke} /><path d="M12.5 4.5 Q15 8 12.5 11.5" {...stroke} /></svg>;
    case 'volume-mute':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 6 L5 6 L9 3 L9 13 L5 10 L2 10 Z" {...stroke} /><path d="M12 6 L15 9 M15 6 L12 9" {...stroke} /></svg>;
    case 'heart':
      return <svg style={s} viewBox="0 0 16 16"><path d="M8 13 C 4 10, 2 8, 2 5.5 C 2 3, 4 2, 5.5 2 C 6.5 2, 7.5 2.7, 8 3.5 C 8.5 2.7, 9.5 2, 10.5 2 C 12 2, 14 3, 14 5.5 C 14 8, 12 10, 8 13 Z" {...stroke} /></svg>;
    case 'bookmark':
      return <svg style={s} viewBox="0 0 16 16"><path d="M4 2 L12 2 L12 14 L8 10.5 L4 14 Z" {...stroke} /></svg>;
    case 'plus':
      return <svg style={s} viewBox="0 0 16 16"><path d="M8 3 L8 13 M3 8 L13 8" {...stroke} /></svg>;
    case 'search':
      return <svg style={s} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" {...stroke} /><path d="M10.5 10.5 L13.5 13.5" {...stroke} /></svg>;
    case 'chevron-left':
      return <svg style={s} viewBox="0 0 16 16"><path d="M10 3 L5 8 L10 13" {...stroke} strokeWidth="1.8" /></svg>;
    case 'chevron-right':
      return <svg style={s} viewBox="0 0 16 16"><path d="M6 3 L11 8 L6 13" {...stroke} strokeWidth="1.8" /></svg>;
    case 'chevron-down':
      return <svg style={s} viewBox="0 0 16 16"><path d="M3 6 L8 11 L13 6" {...stroke} strokeWidth="1.6" /></svg>;
    case 'check':
      return <svg style={s} viewBox="0 0 16 16"><path d="M3 8 L7 12 L13 4" {...stroke} strokeWidth="1.8" /></svg>;
    case 'dot':
      return <svg style={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" {...fill} /></svg>;
    case 'headphones':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 9 L2 12 Q2 14 4 14 L5 14 L5 9 M14 9 L14 12 Q14 14 12 14 L11 14 L11 9" {...stroke} /><path d="M2 9 Q2 3 8 3 Q14 3 14 9" {...stroke} /></svg>;
    case 'speaker':
      return <svg style={s} viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1" {...stroke} /><circle cx="8" cy="9" r="2.5" {...stroke} /><circle cx="8" cy="4.5" r="0.7" {...fill} /></svg>;
    case 'airplay':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 11 L2 3 L14 3 L14 11 L12 11 M4 11 L2 11" {...stroke} /><path d="M5 14 L8 10 L11 14 Z" {...stroke} /></svg>;
    case 'bluetooth':
      return <svg style={s} viewBox="0 0 16 16"><path d="M5 4 L11 12 L8 14 L8 2 L11 4 L5 12" {...stroke} /></svg>;
    case 'monitor':
      return <svg style={s} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="8" rx="1" {...stroke} /><path d="M6 13 L10 13 M8 11 L8 13" {...stroke} /></svg>;
    case 'home':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 8 L8 3 L14 8 L14 13 L10 13 L10 9 L6 9 L6 13 L2 13 Z" {...stroke} /></svg>;
    case 'grid':
      return <svg style={s} viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" {...stroke} /><rect x="9" y="2.5" width="4.5" height="4.5" {...stroke} /><rect x="2.5" y="9" width="4.5" height="4.5" {...stroke} /><rect x="9" y="9" width="4.5" height="4.5" {...stroke} /></svg>;
    case 'list':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 4 L14 4 M2 8 L14 8 M2 12 L14 12" {...stroke} /></svg>;
    case 'kbd':
      return <svg style={s} viewBox="0 0 16 16"><path d="M3 5 L8 5 Q9 5 9 6 L9 9" {...stroke} /><path d="M9 9 L7 7 M9 9 L11 7" {...stroke} /></svg>;
    case 'cast':
      return <svg style={s} viewBox="0 0 16 16"><path d="M2 6 Q2 3 5 3 L11 3 Q14 3 14 6 L14 11 Q14 13 12 13 L8 13" {...stroke} /><path d="M2 9 Q5 9 7 11 Q7 13 5 13" {...stroke} /><circle cx="2" cy="13" r="0.7" {...fill} /></svg>;
    case 'sleep':
      return <svg style={s} viewBox="0 0 16 16"><path d="M13 9 A 5 5 0 1 1 7 3 A 4 4 0 0 0 13 9 Z" {...stroke} /></svg>;
    default: return null;
  }
}

window.Icon = Icon;
