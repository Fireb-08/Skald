// Shared library data + the placeholder Cover component used across all 3 directions.
// Audiobook covers are bespoke artwork — we render typographic placeholders so the
// design rhythm is right without faking specific art. Each cover gets a deterministic
// palette + template based on its index.

const LIBRARY = [
  { id: 'cold-iron', title: 'Cold Iron', author: 'Miles Cameron', series: 'Masters & Mages · 1', dur: '24h 12m', progress: 0.42, narrator: 'Mark Meadows', genre: 'Epic Fantasy', chapters: 38, palette: ['#0a0a0e', '#2a2a36', '#c9a35a'], tpl: 'split',
    synopsis: "Aranthur is a student, a swordsman, and an accidental hero — caught between a war he doesn't understand and a magic he can barely control. A sweeping coming-of-age fantasy from a historian who actually knows how a sword fight ends." },
  { id: 'fell-sword', title: 'The Fell Sword', author: 'Miles Cameron', series: 'Traitor Son · 2', dur: '32h 04m', progress: 0.18, narrator: 'Mark Meadows', genre: 'Epic Fantasy', chapters: 44, palette: ['#1a1612', '#3a2f24', '#d4a14a'], tpl: 'rule',
    synopsis: "The Red Knight's company rides east, into the steppes and into someone else's war. Cameron's grimy, glittering medieval fantasy gets bigger, weirder, and far more political in its second volume." },
  { id: 'sam', title: 'Sufficiently Advanced Magic', author: 'Andrew Rowe', series: 'Arcane Ascension · 1', dur: '27h 20m', progress: 0.71, narrator: 'Nick Podehl', genre: 'Progression Fantasy', chapters: 33, palette: ['#3d4a5c', '#9eb4c4', '#f1e8d8'], tpl: 'numeral',
    synopsis: "Corin Cadence enters the Serpent Spire — a tower of trials that grants a single magical attunement to those who survive. He wants answers about his missing brother. The tower wants something else entirely." },
  { id: 'burning-white', title: 'The Burning White', author: 'Brent Weeks', series: 'Lightbringer · 5', dur: '37h 51m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#2a0808', '#7a1a1a', '#ffd84a'], tpl: 'split',
    synopsis: "The conclusion of Lightbringer. Empires fall, gods stir, and Kip Guile gets one last impossible task. Weeks closes the saga with everything cranked: betrayal, theology, and a great deal of color magic." },
  { id: 'parade', title: 'A Parade of Horribles', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 7', dur: '24h 02m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#3a2418', '#c4642a', '#f0d088'], tpl: 'pattern',
    synopsis: "Carl and Princess Donut hit the seventh floor and the producers of the dungeon are running out of patience. The series' sharpest satire yet — a deadly carnival of corporate cruelty and small kindnesses." },
  { id: 'inevitable', title: 'This Inevitable Ruin', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 6', dur: '22h 41m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#2a1a0a', '#a83a18', '#f4c860'], tpl: 'split',
    synopsis: "PvP arrives on the sixth floor and the survivors of the dungeon turn on each other. Carl tries to hold a fragile alliance together while the system invents new ways to make that impossible." },
  { id: 'bedlam', title: 'The Eye of the Bedlam Bride', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 5', dur: '24h 18m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#1a1a2a', '#5a4a8a', '#e8d460'], tpl: 'rule',
    synopsis: "A wedding, an heirloom, and a fifth floor full of consequences. The Bedlam Bride wants something Carl has — and the dungeon wants to watch them all dance for it." },
  { id: 'butcher', title: "The Butcher's Masquerade", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 4', dur: '23h 50m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#4a1a1a', '#a02828', '#f0e0a0'], tpl: 'numeral',
    synopsis: "The Hunting Grounds open on the fourth floor — a season of teams, ambushes, and lavish, televised bloodshed. Carl learns who really watches the dungeon, and the cost of being watched back." },
  { id: 'feral', title: 'The Gate of the Feral Gods', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 3', dur: '20h 15m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#2a1a0a', '#8a3a18', '#f0c860'], tpl: 'split',
    synopsis: "Snow, gods, and a city that doesn't want to be saved. The third floor lifts the lid on what the dungeon really is, and gives Carl a glimpse of who's profiting from it." },
  { id: 'anarchist', title: "The Dungeon Anarchist's Cookbook", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 2', dur: '19h 38m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#0a1a2a', '#1a5a8a', '#f4e088'], tpl: 'pattern',
    synopsis: "A subway turned slaughterhouse, a rebellion you weren't invited to, and a cat with opinions about explosives. Carl & Donut get political." },
  { id: 'doomsday', title: "Carl's Doomsday Scenario", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 1', dur: '14h 12m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#1a0a0a', '#7a1a2a', '#f8d850'], tpl: 'rule',
    synopsis: "Earth's buildings come down. Carl, his ex-girlfriend's cat, and a cosmic game show are all that's left. The first floor of a dungeon that bills itself as the greatest reality entertainment in the galaxy." },
  { id: 'black-prism', title: 'The Black Prism', author: 'Brent Weeks', series: 'Lightbringer · 1', dur: '23h 36m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#0a1a18', '#1a6a5a', '#9ad8c8'], tpl: 'split',
    synopsis: "Gavin Guile is the Prism — the most powerful drafter alive, and the man who keeps the Seven Satrapies from tearing themselves apart. He has five great purposes, five years to live, and a son he never knew." },
  { id: 'broken-eye', title: 'The Broken Eye', author: 'Brent Weeks', series: 'Lightbringer · 3', dur: '32h 04m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#3a1a08', '#a04828', '#f0c878'], tpl: 'numeral',
    synopsis: "Gavin loses his colors. Kip gets one. An assassins' guild long thought dead crawls back to the surface, and the Chromeria's neat theology starts coming apart at the seams." },
  { id: 'blood-mirror', title: 'The Blood Mirror', author: 'Brent Weeks', series: 'Lightbringer · 4', dur: '30h 17m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#0a0828', '#1a1a6a', '#a8b8f0'], tpl: 'split',
    synopsis: "A White King is rising. Old gods are listed in the kill order. Karris becomes White, and Gavin discovers the bottom of the world." },
  { id: 'blinding', title: 'The Blinding Knife', author: 'Brent Weeks', series: 'Lightbringer · 2', dur: '30h 36m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#1a1a28', '#3a3a4a', '#e84a4a'], tpl: 'rule',
    synopsis: "Gavin Guile only has four years left to live, and a war on his hands. Kip Guile only wants to survive the Blackguard tryouts. Neither will get what they bargained for." },
  { id: 'darkdawn', title: 'Darkdawn', author: 'Jay Kristoff', series: 'Nevernight · 3', dur: '21h 04m', progress: 0, narrator: 'Holter Graham', genre: 'Grimdark', palette: ['#0a0a0a', '#2a2a2a', '#c8b888'], tpl: 'pattern',
    synopsis: "Mia Corvere's vengeance comes to its blood-soaked finale. Kristoff's footnotes get filthier, his prose more luxurious, and his body count climbs to the obscene." },
  { id: 'light-falls', title: 'The Light of All That Falls', author: 'James Islington', series: 'Licanius · 3', dur: '32h 12m', progress: 0, narrator: 'Michael Kramer', genre: 'Epic Fantasy', palette: ['#2a1a1a', '#7a2a2a', '#f0a868'], tpl: 'split',
    synopsis: "Time, prophecy, and the long-game cost of every choice come due. Islington pays off the puzzle-box of the trilogy with patience and one of the cleanest closings in modern epic fantasy." },
  { id: 'emberdark', title: 'Isles of the Emberdark', author: 'Brandon Sanderson', series: 'Cosmere', dur: '21h 47m', progress: 0, narrator: 'Michael Kramer', genre: 'Epic Fantasy', palette: ['#1a0808', '#3a1a0a', '#f0c050'], tpl: 'numeral',
    synopsis: "A standalone Cosmere voyage to the edge of the dark. Sanderson at his most adventure-pulp — sky-ships, ancient threats, and a magic system that doesn't quite play by the rules you know." },
];

// Cover — pure-CSS audiobook cover placeholder. No emoji, no hand-drawn art.
// 6 templates that lean on type + color blocking, which is how good real cover art
// gets surfaced in a catalog: as a wash of color + an arc of letters.
// Aspect is SQUARE (1:1) — audiobook covers are typically square unlike print books.
function Cover({ book, w = 180, scale = 1 }) {
  const [bg, mid, accent] = book.palette;
  const tpl = book.tpl || 'split';
  const h = w; // square
  const base = {
    width: w, height: h, position: 'relative', overflow: 'hidden',
    borderRadius: 4 * scale, background: bg, color: accent,
    flexShrink: 0,
    boxShadow: '0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.25)',
    fontFamily: '"Source Serif Pro", "Iowan Old Style", Georgia, serif',
  };
  const titleSize = Math.max(11, w * 0.095);
  const authorSize = Math.max(8, w * 0.052);

  if (tpl === 'split') {
    return (
      <div style={base}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg, ${mid} 0%, ${bg} 70%)` }} />
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '10%', fontSize: authorSize, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75, fontFamily: 'ui-sans-serif, system-ui' }}>{book.author}</div>
        <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '12%', fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, textWrap: 'balance' }}>{book.title}</div>
        <div style={{ position: 'absolute', left: '8%', bottom: '8%', width: '20%', height: 2, background: accent, opacity: 0.8 }} />
      </div>
    );
  }
  if (tpl === 'rule') {
    return (
      <div style={base}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120% 80% at 50% 0%, ${mid} 0%, ${bg} 75%)` }} />
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: '15%', fontSize: titleSize * 1.05, fontWeight: 700, lineHeight: 1.0, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.01em', textWrap: 'balance' }}>{book.title}</div>
        <div style={{ position: 'absolute', left: '30%', right: '30%', top: '58%', height: 1, background: accent }} />
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: '62%', fontSize: authorSize, textAlign: 'center', letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.85, fontFamily: 'ui-sans-serif, system-ui' }}>{book.author}</div>
      </div>
    );
  }
  if (tpl === 'numeral') {
    const num = (book.series && book.series.match(/\d+/) || ['I'])[0];
    return (
      <div style={base}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg} 0%, ${mid} 100%)` }} />
        <div style={{ position: 'absolute', left: '-5%', top: '-8%', fontSize: w * 0.95, fontWeight: 900, color: accent, opacity: 0.25, fontFamily: 'Georgia, serif', lineHeight: 0.85 }}>{num}</div>
        <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: '18%', fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, textWrap: 'balance' }}>{book.title}</div>
        <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: '10%', fontSize: authorSize, opacity: 0.7, fontFamily: 'ui-sans-serif, system-ui', letterSpacing: '0.06em' }}>{book.author}</div>
      </div>
    );
  }
  if (tpl === 'pattern') {
    const stripes = `repeating-linear-gradient(45deg, ${mid} 0px, ${mid} 6px, ${bg} 6px, ${bg} 14px)`;
    return (
      <div style={base}>
        <div style={{ position: 'absolute', inset: 0, background: stripes, opacity: 0.7 }} />
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '40%', bottom: '20%', background: bg, border: `1.5px solid ${accent}`, padding: '6%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, textWrap: 'balance' }}>{book.title}</div>
          <div style={{ fontSize: authorSize, fontFamily: 'ui-sans-serif, system-ui', opacity: 0.75, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{book.author}</div>
        </div>
      </div>
    );
  }
  // default: minimal
  return (
    <div style={base}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg, ${mid}, ${bg})` }} />
      <div style={{ position: 'absolute', left: '10%', right: '10%', top: '40%', fontSize: titleSize, fontWeight: 600, textWrap: 'balance' }}>{book.title}</div>
    </div>
  );
}

// Tiny waveform (deterministic, no canvas) — used by the Now Playing screens.
// `flat` keeps every bar at full container height for a chunky timeline look
// instead of an audio-style envelope.
function Waveform({ width = 600, height = 80, progress = 0.42, color = '#fff', dim = 'rgba(255,255,255,0.22)', bars = 110, seed = 7, flat = false }) {
  const arr = [];
  let s = seed;
  for (let i = 0; i < bars; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    if (flat) {
      arr.push(height);
      continue;
    }
    // shape envelope: gentle hills + a couple of peaks
    const env = 0.35 + 0.55 * Math.abs(Math.sin(i / bars * Math.PI * 2.2)) + 0.18 * Math.sin(i / 3);
    // Cap fraction at 1, then scale by height; floor at 2px so quiet sections still show.
    const h = Math.max(2, Math.min(1, env + (r - 0.5) * 0.55) * height);
    arr.push(h);
  }
  const barW = width / bars;
  const playedTo = Math.floor(bars * progress);
  return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', gap: 0 }}>
      {arr.map((h, i) => (
        <div key={i} style={{
          width: barW - 1,
          height: h,
          marginRight: 1,
          background: i < playedTo ? color : dim,
          borderRadius: 1,
        }} />
      ))}
    </div>
  );
}

window.LIBRARY = LIBRARY;
window.Cover = Cover;
window.Waveform = Waveform;
