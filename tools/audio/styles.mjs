// Three complete rescorings of the recovered voices, rendered offline.
export const STYLE_VARIANTS = ['synthwave', 'ambient', 'space-rock'];

export function createStyleArrangement(base, variant) {
    const palettes = {
        synthwave: {
            programs: [80, 81, 81, 90, 89, 38, 39, 81, 98, 91, 0, 0],
            gains: [-24, -26, -3, -13, -21, -4, -17, -25, -28, -28, -9, -25],
            wet: 20,
            tail: 3.2,
        },
        ambient: {
            programs: [98, 99, 98, 89, 88, 39, 38, 91, 98, 91, 0, 0],
            gains: [-30, -30, -9, -14, -22, -15, -28, -28, -30, -24, -60, -60],
            wet: 46,
            tail: 5,
        },
        'space-rock': {
            programs: [80, 81, 30, 28, 89, 34, 33, 27, 27, 89, 0, 0],
            gains: [-25, -25, -6, -17, -26, -8, -20, -22, -28, -28, -10, -23],
            wet: 18,
            tail: 3.2,
        },
    };
    const palette = palettes[variant];
    if (!palette) throw new RangeError('Unknown non-orchestral style.');
    const roles = [
        'Arpeggio',
        'Echo colour',
        'Lead',
        'Harmony',
        'Pad',
        'Bass',
        'Sub bass',
        'Texture',
        'Accent',
        'Atmosphere',
        'Kick and snare',
        'Hi-hats',
    ];
    const tracks = base.tracks.map((track, index) => ({
        ...track,
        name: `${variant} / ${roles[index]}`,
        program: palette.programs[index],
        family:
            index >= 10
                ? 'percussion'
                : variant === 'space-rock' && [2, 3, 7, 8].includes(index)
                  ? 'electric-guitar'
                  : variant === 'space-rock' && [5, 6].includes(index)
                    ? 'electric-bass'
                    : 'electronic',
        gainDb: palette.gains[index],
        expression: false,
        percussion: index >= 10,
    }));
    const notes = base.notes.filter(
        (note) => !['percussion', 'cymbal', 'timpani', 'wind-counterline'].includes(note.role),
    );
    // Align new accompaniment with the archived interrupt grid. A new quarter
    // is 40 driver ticks; its 1.5x timing follows the preserved melody exactly.
    const atTick = (tick) => (Math.floor((tick * 5) / 9) / 50) * base.timeScale;
    function add(track, role, note, velocity, tick, duration = 0.12, cents = 0) {
        const seconds = atTick(tick);
        if (seconds >= base.sourceStopSeconds) return;
        notes.push({
            track,
            role,
            note,
            velocity,
            cents,
            seconds,
            endSeconds: Math.min(base.sourceStopSeconds, seconds + duration),
            sourceVoice: false,
        });
    }
    if (variant !== 'ambient') {
        for (let tick = 0, beat = 0; atTick(tick) < base.sourceStopSeconds; tick += 40, beat++) {
            if (variant === 'synthwave' || beat % 2 === 0) add(10, 'drum-pattern', 36, 66, tick);
            if (beat % 2 === 1) add(10, 'drum-pattern', 38, 58, tick);
            add(11, 'drum-pattern', 42, beat % 2 === 0 ? 39 : 31, tick, 0.08);
            if (variant === 'synthwave') add(11, 'drum-pattern', 42, 25, tick + 20, 0.06);
        }
    }
    if (variant === 'synthwave') {
        const harmony = notes.filter((note) => note.sourceVoice && note.role === 'harmony');
        let index = 0;
        for (
            let tick = 0, position = 0;
            atTick(tick) < base.sourceStopSeconds;
            tick += 20, position++
        ) {
            while (index + 1 < harmony.length && harmony[index + 1].seconds <= atTick(tick))
                index++;
            const current = harmony[index];
            if (current && current.seconds <= atTick(tick) && atTick(tick) < current.endSeconds) {
                add(
                    0,
                    'synth-arpeggio',
                    Math.min(108, current.note + (position % 2 ? 12 : 0)),
                    49,
                    tick,
                    0.18,
                    current.cents,
                );
            }
        }
    }
    notes.sort((a, b) => a.seconds - b.seconds || a.track - b.track || a.note - b.note);
    return {
        ...base,
        variant,
        tracks,
        notes,
        reverbPercent: palette.wet,
        durationSeconds: base.sourceStopSeconds + palette.tail,
    };
}
