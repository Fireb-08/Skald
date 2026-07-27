//! Adaptive auto-rewind: how far to step back when resuming after a pause.
//!
//! The idea is that the longer you were away, the more context you need to pick
//! the thread back up — a ten-second interruption needs a second or two, a night's
//! sleep needs half a minute. Skald previously applied one fixed amount regardless.
//!
//! All of this is pure arithmetic, deliberately: the curve is the part most likely
//! to be re-tuned by feel, and re-tuning is only safe when a table test pins what
//! the current shape actually produces.

use serde::{Deserialize, Serialize};

/// User-facing configuration, mirrored from `onyx.playback.rewind` (the legacy
/// fixed step) and `onyx.playback.autoRewind.*` (everything else).
///
/// Describes **both** modes rather than only the new one, so a single backend
/// path decides every resume. The alternative — adaptive in Rust, fixed left in
/// the frontend — would have kept the two divergent copies this feature exists
/// to eliminate.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRewindCfg {
    /// Scale the rewind with time away. Off means `fixed_secs` applies as it
    /// always has: an existing install must not find its shipped setting
    /// silently reinterpreted on upgrade.
    pub adaptive: bool,
    /// The legacy fixed step (`onyx.playback.rewind`). Applies on every resume
    /// when `adaptive` is off; ignored when it is on.
    pub fixed_secs: f64,
    /// Rewind for the shortest qualifying pause.
    pub min_secs: f64,
    /// Rewind for a pause long enough to have lost the thread completely.
    pub max_secs: f64,
    /// Pauses shorter than this rewind nothing at all. Zero means "always rewind",
    /// which is Absorb's default.
    pub activation_delay_secs: f64,
    /// Never rewind past the start of the chapter you are in.
    pub chapter_barrier: bool,
    /// Also apply the curve when opening a book afresh, based on how long it has
    /// been since you last listened.
    pub session_start_rewind: bool,
}

impl Default for AutoRewindCfg {
    fn default() -> Self {
        // Adaptive is opt-in and the fixed default matches PlaybackSection's, so
        // an install that never opens Settings behaves exactly as it does today.
        // The min/max span is Absorb's.
        Self {
            adaptive: false,
            fixed_secs: 5.0,
            min_secs: 1.0,
            max_secs: 30.0,
            activation_delay_secs: 0.0,
            chapter_barrier: false,
            session_start_rewind: false,
        }
    }
}

/// Anchor points for the curve: `(pause seconds, fraction of the min..max span)`.
///
/// Piecewise-linear in **log** time, because the interesting range spans four
/// orders of magnitude — a linear ramp would spend almost all its resolution
/// between "an hour" and "six hours", where nobody can tell the difference, and
/// none between ten seconds and a minute, where everybody can.
///
/// The fractions come from the roadmap's proposed shape; with the default 1–30 s
/// span they land on roughly 1 s / 5 s / 11 s / 21 s / 30 s. Change them only
/// after a listening pass, and re-freeze `rewind_curve_table` when you do.
const CURVE: [(f64, f64); 5] = [
    (10.0, 0.00),    // 10 s — barely away
    (60.0, 0.15),    // a minute
    (600.0, 0.35),   // ten minutes
    (3600.0, 0.70),  // an hour
    (21600.0, 1.00), // six hours — treat anything longer the same
];

/// How far back to step, in seconds.
///
/// `pause_secs` is `None` when there was no preceding pause to measure — a
/// resume after a cold start, or one that follows another resume. In adaptive
/// mode that means no rewind; in fixed mode the step still applies, because that
/// is what the shipped behaviour does and changing it would be a silent
/// reinterpretation of the user's setting.
///
/// In adaptive mode the result is always within `[min_secs, max_secs]` and
/// monotonically non-decreasing in `pause_secs`.
pub fn rewind_amount(pause_secs: Option<f64>, cfg: &AutoRewindCfg) -> f64 {
    if !cfg.adaptive {
        return cfg.fixed_secs.max(0.0);
    }

    let Some(pause) = pause_secs.filter(|s| s.is_finite() && *s > 0.0) else {
        return 0.0;
    };
    if pause < cfg.activation_delay_secs {
        return 0.0;
    }

    // Tolerate a config with the bounds inverted rather than returning something
    // absurd; the UI prevents it, but the value crosses an IPC boundary.
    let min = cfg.min_secs.max(0.0);
    let max = cfg.max_secs.max(min);

    min + (max - min) * curve_fraction(pause)
}

/// Position along the min..max span, in `0.0..=1.0`, for a given pause.
fn curve_fraction(pause_secs: f64) -> f64 {
    let first = CURVE[0];
    let last = CURVE[CURVE.len() - 1];
    if pause_secs <= first.0 {
        return first.1;
    }
    if pause_secs >= last.0 {
        return last.1;
    }

    let t = pause_secs.ln();
    for pair in CURVE.windows(2) {
        let (lo_secs, lo_frac) = pair[0];
        let (hi_secs, hi_frac) = pair[1];
        if pause_secs <= hi_secs {
            let span = hi_secs.ln() - lo_secs.ln();
            let progress = if span > 0.0 { (t - lo_secs.ln()) / span } else { 0.0 };
            return lo_frac + (hi_frac - lo_frac) * progress;
        }
    }
    last.1
}

/// Where to actually seek to, given the current position and an optional barrier.
///
/// `barrier` is the start of the chapter the listener is in, when the
/// chapter-barrier option is on. Skald's chapter list lives on the frontend, so
/// the caller supplies it rather than this module looking it up.
pub fn rewind_target(position: f64, amount: f64, barrier: Option<f64>) -> f64 {
    let raw = (position - amount).max(0.0);
    match barrier {
        // Only a barrier *behind* the listener can hold them back. One that is
        // somehow ahead would otherwise skip them forward, which is never what a
        // rewind should do.
        Some(start) if start.is_finite() && start <= position => raw.max(start),
        _ => raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> AutoRewindCfg {
        AutoRewindCfg { adaptive: true, ..Default::default() }
    }

    /// Freezes the shape of the curve. If a listening pass re-tunes `CURVE`, this
    /// table is what says so out loud instead of the change slipping by.
    #[test]
    fn rewind_curve_table() {
        let cfg = cfg(); // 1 s .. 30 s
        let cases: [(f64, f64); 7] = [
            (0.0, 0.0),        // not paused
            (5.0, 1.0),        // below the first anchor → min
            (10.0, 1.0),       // exactly the first anchor
            (60.0, 5.35),      // a minute
            (600.0, 11.15),    // ten minutes
            (3600.0, 21.30),   // an hour
            (7200.0, 24.67),   // two hours, still climbing toward max
        ];
        for (pause, expected) in cases {
            let got = rewind_amount(Some(pause), &cfg);
            assert!(
                (got - expected).abs() < 0.05,
                "pause {pause}s → expected ~{expected}, got {got}"
            );
        }
        // Six hours or more saturates at max and never exceeds it.
        assert_eq!(rewind_amount(Some(21_600.0), &cfg), 30.0);
        assert_eq!(rewind_amount(Some(86_400.0), &cfg), 30.0);
    }

    #[test]
    fn curve_is_monotonic_and_stays_within_bounds() {
        let cfg = cfg();
        let mut previous = 0.0;
        // Walk the whole interesting range, not just the anchors — a bad
        // interpolation can be correct at every anchor and wrong between them.
        let mut pause = 1.0;
        while pause < 100_000.0 {
            let amount = rewind_amount(Some(pause), &cfg);
            assert!(amount >= previous, "curve dipped at {pause}s: {previous} → {amount}");
            assert!(
                (cfg.min_secs..=cfg.max_secs).contains(&amount),
                "{amount} outside [{}, {}] at {pause}s",
                cfg.min_secs,
                cfg.max_secs
            );
            previous = amount;
            pause *= 1.15;
        }
    }

    #[test]
    fn activation_delay_zeroes_short_pauses() {
        let cfg = AutoRewindCfg { activation_delay_secs: 30.0, ..cfg() };
        assert_eq!(rewind_amount(Some(5.0), &cfg), 0.0);
        assert_eq!(rewind_amount(Some(29.9), &cfg), 0.0);
        // At the threshold the curve takes over.
        assert!(rewind_amount(Some(30.0), &cfg) > 0.0);
    }

    #[test]
    fn fixed_mode_applies_the_legacy_step_on_every_resume() {
        // The regression guard for existing users: adaptive off must behave
        // exactly like the shipped fixed rewind, including on a resume with no
        // measurable pause behind it.
        let cfg = AutoRewindCfg { adaptive: false, fixed_secs: 5.0, ..Default::default() };
        for pause in [None, Some(0.0), Some(1.0), Some(3600.0), Some(86_400.0)] {
            assert_eq!(rewind_amount(pause, &cfg), 5.0, "pause {pause:?}");
        }

        // "Off" in the settings segment stores 0 and must rewind nothing.
        let off = AutoRewindCfg { fixed_secs: 0.0, ..cfg };
        assert_eq!(rewind_amount(Some(3600.0), &off), 0.0);
    }

    #[test]
    fn adaptive_without_a_measured_pause_rewinds_nothing() {
        // Cold start, or a resume that follows another resume.
        assert_eq!(rewind_amount(None, &cfg()), 0.0);
    }

    #[test]
    fn nonsensical_pause_values_rewind_nothing() {
        let cfg = cfg();
        // A clock that jumped backwards, or an uninitialised duration.
        assert_eq!(rewind_amount(Some(-5.0), &cfg), 0.0);
        assert_eq!(rewind_amount(Some(f64::NAN), &cfg), 0.0);
        assert_eq!(rewind_amount(Some(f64::INFINITY), &cfg), 0.0);
    }

    #[test]
    fn inverted_bounds_do_not_produce_a_negative_rewind() {
        // The UI prevents this, but the value arrives over IPC.
        let cfg = AutoRewindCfg { min_secs: 20.0, max_secs: 5.0, ..cfg() };
        let amount = rewind_amount(Some(3600.0), &cfg);
        assert_eq!(amount, 20.0, "max below min collapses to min, never negative");
    }

    #[test]
    fn chapter_barrier_clamps() {
        // Rewinding 30 s from 100 s would land at 70 s, inside the previous
        // chapter; the barrier holds it at the chapter head.
        assert_eq!(rewind_target(100.0, 30.0, Some(90.0)), 90.0);
        // A rewind that stays inside the chapter is untouched.
        assert_eq!(rewind_target(100.0, 5.0, Some(90.0)), 95.0);
        // Already at the chapter head → no rewind past it.
        assert_eq!(rewind_target(90.0, 30.0, Some(90.0)), 90.0);
        // Barrier off: free to cross, but never before the start of the book.
        assert_eq!(rewind_target(100.0, 30.0, None), 70.0);
        assert_eq!(rewind_target(10.0, 30.0, None), 0.0);
    }

    #[test]
    fn a_barrier_ahead_of_the_listener_is_ignored() {
        // Defensive: a stale chapter index must never seek the listener *forward*.
        assert_eq!(rewind_target(100.0, 10.0, Some(150.0)), 90.0);
    }
}
