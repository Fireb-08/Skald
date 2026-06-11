## 

### The Audio Engineering Rationale

For speech, three zones matter:

|Zone|Bands|Role|
|---|---|---|
|**Mud**|170–600 Hz|Body/warmth of voice — excess here makes speech boomy and unclear|
|**Presence**|1k–3k Hz|Consonants, syllable definition — the primary intelligibility band|
|**Air / Sibilance**|6k–16k Hz|Crispness and detail — too much causes harshness; too little sounds dull|

All presets keep adjustments within **±6 dB** to avoid distortion artifacts.

---

### Preset 1 — Voice Clarity _(universal default)_

> General-purpose spoken word. Cleans up mud in the low-mids and lifts the presence peak. Works well for most recordings, headphones or speakers.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|-2|-3|-4|-2|0|+4|+2|+1|0|0|0|

Key moves: heavy cut at 310 Hz (the principal "mud" band for voice), strong +4 at 3k (peak consonant clarity zone).

---

### Preset 2 — Warm Narrator _(bedtime / relaxed listening)_

> For rich, intimate narrators. Preserves bass warmth and softens the upper range for easy late-night listening without fatigue.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|+1|+2|0|-1|0|+2|0|-1|-2|-3|0|

Key moves: gentle bass warmth, modest +2 presence, rolled-off highs for fatigue-free listening.

---

### Preset 3 — Commute _(noisy environments)_

> Cuts through road noise, train rumble, and ambient noise. Aggressively reduces low-end that competes with speech and maximises the intelligibility band.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|-6|-5|-4|-2|+2|+6|+4|+2|0|0|-2|

Key moves: deep bass shelf cut (-6 at 60), maximum +6 at 3k presence, preamp backed off -2 to headroom-compensate for the big boost.

---

### Preset 4 — Night Mode _(low volume, quiet room)_

> At low volumes, human hearing loses sensitivity to lows and highs (Fletcher-Munson effect). This compensates by gently lifting the speech fundamental and presence range so intelligibility holds at quiet levels.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|-3|-2|0|+1|+3|+4|+2|0|0|0|+2|

Key moves: roll off rumble, lift 1k–3k substantially, +2 preamp to compensate for quiet playback.

---

### Preset 5 — Headphones _(closed-back / earbuds)_

> Headphones typically over-emphasise bass and can be harsh in the 6k sibilance range. This trims both and lifts 3k for word clarity without fatigue.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|-3|-2|-2|0|0|+3|-1|0|-1|-2|0|

Key moves: cut the typical headphone bass hump, slight sibilance tame at 6k and 16k.

---

### Preset 6 — Speakers / Desktop _(open room)_

> Room acoustics tend to build up bass in corners and at listening distance. This applies a low-end cut appropriate for near/mid-field desktop speaker listening.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|-4|-3|-2|-1|0|+3|+2|+1|0|0|0|

Key moves: low-shelf cut for room compensation, gentle presence boost, slight 6k–12k air lift.

---

### Preset 7 — De-Harsh _(bright or sibilant recordings)_

> Some audiobook productions are recorded too bright, or the narrator has pronounced sibilance (over-present "s" and "t" sounds). This tames 6k–16k without dulling the presence.

|60|170|310|600|1k|3k|6k|12k|14k|16k|Preamp|
|---|---|---|---|---|---|---|---|---|---|---|
|0|0|-1|0|0|+2|-3|-2|-3|-4|0|

Key moves: keep the 1k–3k intelligibility intact, cut the sibilance shelf at 6k and above.

---

### Summary

|Preset|Best for|
|---|---|
|Voice Clarity|General use — start here|
|Warm Narrator|Relaxed / bedtime listening|
|Commute|In a car, train, or bus|
|Night Mode|Quiet room at low volume|
|Headphones|Earbuds / closed-back cans|
|Speakers|Desktop or bookshelf speakers|
|De-Harsh|Bright or sibilant narrators|

These seven cover the primary audiobook listening contexts and make a cohesive, purpose-built set to ship alongside (or replace) the existing music-oriented presets. Want me to implement these directly into the codebase?