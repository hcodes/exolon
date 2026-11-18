import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    analyzeWave,
    createArrangement as untypedCreateArrangement,
    masterWave,
    mixGusli,
    parseArrangementArguments,
    verifyArrangementOutput,
} from '../../tools/audio/arrange.mjs';

interface SourceEvent {
    channel: number;
    tick: number;
    tone: boolean;
    noise: boolean;
    seconds: number;
    endSeconds: number;
    midiNote: number;
    midi: number;
}
interface SourceScore {
    events: SourceEvent[];
    sourceStopSeconds: number;
}
interface ArrangementNote {
    track: number;
    note: number;
    cents: number;
    velocity: number;
    seconds: number;
    endSeconds: number;
    role: string;
    sourceVoice: boolean;
    source: Pick<SourceEvent, 'channel' | 'tick'> & Partial<SourceEvent>;
}
interface ArrangementTrack {
    family: string;
    program: number;
    gainDb: number;
    pan: number;
    percussion?: boolean;
    expression?: boolean;
    instrument?: string;
}
interface Arrangement {
    variant: string;
    notes: ArrangementNote[];
    tracks: ArrangementTrack[];
    sourceStopSeconds: number;
    durationSeconds: number;
    timeScale: number;
    reverbPercent: number;
}
const createArrangement: (score: SourceScore, options?: { variant: string }) => Arrangement =
    untypedCreateArrangement;

const score: SourceScore = JSON.parse(
    await readFile(new URL('../../tools/audio/title-score.json', import.meta.url), 'utf8'),
);
const key = (event: Pick<SourceEvent, 'channel' | 'tick'>) => `${event.channel}:${event.tick}`;
const originalArrangement = () => createArrangement(score, { variant: 'original-orchestral' });

test('all original pitched voices retain exact source onsets, cutoffs and tuning', () => {
    const arrangement = originalArrangement();
    const originals = score.events.filter((event) => event.tone);
    const voices = arrangement.notes.filter(
        (note) => note.sourceVoice && note.role !== 'percussion',
    );
    assert.equal(voices.length, originals.length);
    const bySource = new Map(voices.map((note) => [key(note.source), note]));
    for (const original of originals) {
        const note = bySource.get(key(original));
        assert.ok(note);
        assert.equal(note.seconds, original.seconds);
        assert.equal(note.endSeconds, original.endSeconds);
        assert.equal(note.note, original.midiNote);
        assert.ok(Math.abs(note.note + note.cents / 100 - original.midi) < 1e-10);
    }
    assert.equal(arrangement.sourceStopSeconds, score.sourceStopSeconds);
    assert.ok(arrangement.durationSeconds > score.sourceStopSeconds);
    assert.ok(arrangement.durationSeconds < score.sourceStopSeconds + 4);
});

test('the rescore uses orchestral samples and preserves source percussion as an independent voice', () => {
    const arrangement = originalArrangement();
    const families = new Set(arrangement.tracks.map((track) => track.family));
    for (const family of [
        'woodwind',
        'strings',
        'brass',
        'choir',
        'celesta',
        'timpani',
        'percussion',
    ]) {
        assert.ok(families.has(family));
    }
    const noise = arrangement.notes.filter(
        (note) => note.sourceVoice && note.role === 'percussion',
    );
    assert.equal(noise.length, score.events.filter((event) => !event.tone && event.noise).length);
    for (const note of noise) assert.equal(arrangement.tracks[note.track].percussion, true);
    assert.ok(arrangement.notes.some((note) => !note.sourceVoice));
});

test('arranging is deterministic, leaves the source intact and produces bounded MIDI events', () => {
    const before = structuredClone(score);
    const arrangement = originalArrangement();
    assert.deepEqual(originalArrangement(), arrangement);
    assert.deepEqual(score, before);
    for (const note of arrangement.notes) {
        assert.ok(Number.isFinite(note.seconds) && note.seconds >= 0);
        assert.ok(note.endSeconds > note.seconds && note.endSeconds <= score.sourceStopSeconds);
        assert.ok(Number.isInteger(note.note) && note.note >= 0 && note.note <= 127);
        assert.ok(Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127);
        assert.ok(Number.isFinite(note.cents) && Math.abs(note.cents) < 100);
    }
    assert.throws(
        () =>
            createArrangement(
                { ...score, events: [{ ...score.events[0], endSeconds: -1 }] },
                { variant: 'original-orchestral' },
            ),
        RangeError,
    );
});

test('the slower strings-winds profile preserves pitches and uniformly stretches every source voice', () => {
    const arrangement = createArrangement(score, { variant: 'strings-winds' });
    assert.equal(arrangement.variant, 'strings-winds');
    assert.equal(arrangement.timeScale, 1.5);
    const voices = new Map(
        arrangement.notes
            .filter((note) => note.sourceVoice && note.role !== 'percussion')
            .map((note) => [key(note.source), note]),
    );
    assert.equal(voices.size, score.events.filter((event) => event.tone).length);
    for (const event of score.events.filter((event) => event.tone)) {
        const note = voices.get(key(event))!;
        assert.equal(note.seconds, event.seconds * arrangement.timeScale);
        assert.equal(note.endSeconds, event.endSeconds * arrangement.timeScale);
        assert.equal(note.source.seconds, event.seconds);
        assert.equal(note.source.endSeconds, event.endSeconds);
        assert.equal(note.note, event.midiNote);
    }
    assert.equal(arrangement.sourceStopSeconds, score.sourceStopSeconds * arrangement.timeScale);
    assert.ok(arrangement.durationSeconds > 109 && arrangement.durationSeconds < 113);
});

test('violin and woodwinds lead the slower profile over warm strings and sparse quiet percussion', () => {
    const arrangement = createArrangement(score, { variant: 'strings-winds' });
    const melody = arrangement.notes.filter((note) => note.role === 'melody');
    assert.ok(melody.length > 300);
    for (const note of melody) assert.equal(arrangement.tracks[note.track].program, 40);
    assert.ok(arrangement.notes.filter((note) => note.role === 'wind-counterline').length > 250);
    const violin = arrangement.tracks.find((track) => track.program === 40)!;
    const strings = arrangement.tracks.find((track) => track.program === 48)!;
    const winds = arrangement.tracks.filter((track) => track.family === 'woodwind');
    assert.ok(violin.gainDb > strings.gainDb);
    assert.ok(winds.every((track) => track.gainDb > strings.gainDb));
    assert.ok(
        arrangement.tracks.find((track) => track.family === 'brass')!.gainDb > strings.gainDb,
    );
    const percussion = arrangement.notes.filter((note) => note.role === 'percussion');
    assert.ok(percussion.length > 0 && percussion.length < 12);
    assert.ok(percussion.every((note) => note.velocity <= 32));
    assert.ok(arrangement.tracks.filter((track) => track.expression).length >= 3);
});

test('the first orchestral take and its scoring remain preserved and CLI defaults to a separate file', async () => {
    assert.equal(
        createHash('sha256').update(JSON.stringify(originalArrangement())).digest('hex'),
        'e7603229f3189c1004201632d294f2963a10b257869b902f7d84b95d618ed93c',
    );
    const first = new URL('../../originals/audio/title-orchestral.m4a', import.meta.url);
    assert.equal(
        createHash('sha256')
            .update(await readFile(first))
            .digest('hex'),
        'bbef2ea4513b1624b0aa4d67a45efd2f1b78d27a4c5a5acb72511e4f006e6fa4',
    );
    const request = parseArrangementArguments(['--variant', 'strings-winds']);
    assert.equal(request.variant, 'strings-winds');
    assert.ok(request.output.endsWith('/title-orchestral-strings.m4a'));
    assert.equal(
        createHash('sha256')
            .update(await readFile(request.output))
            .digest('hex'),
        '618f714ec28ebfd046874ab7e28cf68a7e894503d5ec393ec4f1925da2971c08',
    );
    await assert.rejects(verifyArrangementOutput(request.output), /overwrite/i);
    const original = parseArrangementArguments(['--variant', 'original-orchestral']);
    assert.ok(original.output.endsWith('/title-orchestral.m4a'));
    await assert.rejects(verifyArrangementOutput(original.output), /overwrite/i);
    assert.throws(() => createArrangement(score, { variant: 'unknown' }), RangeError);
});

test('the new default gives the complete melody to a forward solo violin with quieter wind accompaniment', () => {
    const previous = createArrangement(score, { variant: 'strings-winds' });
    assert.equal(
        createHash('sha256').update(JSON.stringify(previous)).digest('hex'),
        '6ae922a472792964418d7e004199add7cadfc55371e86915e48595fc6eea4866',
    );
    const arrangement = createArrangement(score, { variant: 'violin-lead' });
    assert.equal(arrangement.variant, 'violin-lead');
    const melody = arrangement.notes.filter((note) => note.role === 'melody');
    const previousMelody = previous.notes.filter((note) => note.role === 'melody');
    assert.equal(
        melody.length,
        score.events.filter((event) => event.tone && event.channel === 0).length,
    );
    melody.forEach((note, index) => {
        assert.equal(arrangement.tracks[note.track].program, 40);
        for (const property of ['seconds', 'endSeconds', 'note', 'cents'] as const) {
            assert.equal(note[property], previousMelody[index][property]);
        }
        assert.ok(note.velocity > previousMelody[index].velocity);
    });
    const violin = arrangement.tracks.find((track) => track.program === 40)!;
    assert.ok(Math.abs(violin.pan) < 0.1);
    assert.ok(
        arrangement.tracks
            .filter((track) => track.family === 'woodwind')
            .every((track) => violin.gainDb - track.gainDb >= 12),
    );
    assert.ok(arrangement.notes.some((note) => note.role === 'wind-counterline'));
    assert.ok(!arrangement.notes.some((note) => ['horn', 'celesta'].includes(note.role)));
    assert.ok(arrangement.reverbPercent < previous.reverbPercent);
    assert.equal(arrangement.timeScale, 1.5);
    assert.equal(arrangement.durationSeconds, previous.durationSeconds);
    const request = parseArrangementArguments(['--variant', 'violin-lead']);
    assert.equal(request.variant, 'violin-lead');
    assert.ok(request.output.endsWith('/title-violin-lead.m4a'));
});

test('gusli replaces the main melody while preserving the slower score and every earlier take', async () => {
    const violin = createArrangement(score, { variant: 'violin-lead' });
    assert.equal(
        createHash('sha256').update(JSON.stringify(violin)).digest('hex'),
        '0789f388fdb6751e006a2a123981a0646c7e9a35e22abd9f2091d803f5d13840',
    );
    const preserved = new URL('../../originals/audio/title-violin-lead.m4a', import.meta.url);
    assert.equal(
        createHash('sha256')
            .update(await readFile(preserved))
            .digest('hex'),
        '33498a5020e6c3041062f65be1011151a3e40acb929c45151cbbca55e87c9398',
    );
    const arrangement = createArrangement(score);
    assert.equal(arrangement.variant, 'gusli-lead');
    assert.deepEqual(arrangement.notes, violin.notes);
    for (const note of arrangement.notes.filter((note) => note.role === 'melody')) {
        assert.equal(arrangement.tracks[note.track].instrument, 'gusli');
    }
    assert.equal(arrangement.timeScale, violin.timeScale);
    assert.equal(arrangement.durationSeconds, violin.durationSeconds);
    const request = parseArrangementArguments([]);
    assert.equal(request.variant, 'gusli-lead');
    assert.ok(request.output.endsWith('/title-gusli-lead.m4a'));
});

test('guitar and organ use their sampled instruments while keeping the complete slower melody', () => {
    const violin = createArrangement(score, { variant: 'violin-lead' });
    const gusli = createArrangement(score, { variant: 'gusli-lead' });
    assert.equal(
        createHash('sha256').update(JSON.stringify(gusli)).digest('hex'),
        '2aa9a64e11449751991cf36790ce9289cef9fd4fc6509f8099f3ba7a67c86b19',
    );
    for (const [variant, program, file] of [
        ['guitar-lead', 24, 'title-guitar-lead.m4a'],
        ['organ-lead', 19, 'title-organ-lead.m4a'],
    ] as const) {
        const arrangement = createArrangement(score, { variant });
        assert.equal(arrangement.variant, variant);
        assert.deepEqual(arrangement.notes, violin.notes);
        assert.equal(arrangement.durationSeconds, 111.23);
        for (const note of arrangement.notes.filter((note) => note.role === 'melody')) {
            const track = arrangement.tracks[note.track];
            assert.equal(track.program, program);
            assert.equal(
                track.instrument,
                undefined,
                'The native sampler must render these lead notes',
            );
            assert.equal(track.expression, false);
        }
        const request = parseArrangementArguments(['--variant', variant]);
        assert.ok(request.output.endsWith('/' + file));
    }
});

test('non-orchestral styles rescore every source voice and provide distinct accompaniment', () => {
    const source = createArrangement(score, { variant: 'violin-lead' });
    const pitched = source.notes.filter((note) => note.sourceVoice && note.role !== 'percussion');
    const signatures = new Set();
    for (const variant of ['synthwave', 'ambient', 'space-rock']) {
        const arrangement = createArrangement(score, { variant });
        assert.equal(arrangement.variant, variant);
        assert.deepEqual(
            arrangement.notes.filter((note) => note.sourceVoice),
            pitched,
        );
        assert.ok(
            arrangement.tracks.every(
                (track) =>
                    !['woodwind', 'strings', 'brass', 'choir', 'celesta', 'timpani'].includes(
                        track.family,
                    ),
            ),
        );
        const rhythm = arrangement.notes.filter((note) => note.role === 'drum-pattern');
        if (variant === 'ambient') {
            assert.equal(rhythm.length, 0);
            assert.ok(arrangement.durationSeconds > 112);
        } else {
            assert.ok(rhythm.length > 200);
            assert.ok(rhythm.every((note) => arrangement.tracks[note.track].percussion));
            assert.ok(rhythm.every((note) => note.endSeconds <= arrangement.sourceStopSeconds));
            const kicks = rhythm.filter((note) => note.note === 36).slice(0, 4);
            const onsets = variant === 'synthwave' ? [0, 0.66, 1.32, 1.98] : [0, 1.32, 2.64, 3.99];
            kicks.forEach((note, index) =>
                assert.ok(Math.abs(note.seconds - onsets[index]) < 1e-10),
            );
        }
        if (variant === 'synthwave')
            assert.ok(arrangement.notes.some((note) => note.role === 'synth-arpeggio'));
        signatures.add(arrangement.tracks.map((track) => track.program).join(','));
        assert.ok(
            parseArrangementArguments(['--variant', variant]).output.endsWith(
                `/title-${variant}.m4a`,
            ),
        );
    }
    assert.equal(signatures.size, 3);
});

function floatWave(samples: number[], sampleRate = 1000, channels = 2) {
    const wave = Buffer.alloc(44 + samples.length * 4);
    wave.write('RIFF', 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(3, 20);
    wave.writeUInt16LE(channels, 22);
    wave.writeUInt32LE(sampleRate, 24);
    wave.writeUInt32LE(sampleRate * channels * 4, 28);
    wave.writeUInt16LE(channels * 4, 32);
    wave.writeUInt16LE(32, 34);
    wave.write('data', 36);
    wave.writeUInt32LE(samples.length * 4, 40);
    samples.forEach((sample, index) => wave.writeFloatLE(sample, 44 + index * 4));
    return wave;
}

test('the exported PCM contains gusli at its scheduled onset while retaining the native accompaniment', () => {
    const sampleRate = 22050;
    const input = floatWave(Array(sampleRate * 2 * 2).fill(0.001), sampleRate);
    const note = { track: 0, note: 69, cents: 0, velocity: 95, seconds: 0.2, endSeconds: 0.5 };
    const plan = { tracks: [{ instrument: 'gusli', gainDb: 0, pan: -0.04 }], notes: [note] };
    const mixed = mixGusli(input, plan);
    assert.deepEqual(
        mixed.subarray(44, 44 + Math.floor(0.2 * sampleRate) * 8),
        input.subarray(44, 44 + Math.floor(0.2 * sampleRate) * 8),
    );
    const stats = analyzeWave(mixed);
    assert.equal(stats.durationSeconds, 2);
    assert.equal(stats.channels, 2);
    assert.ok(stats.rms > 0.005);
    assert.ok(stats.peak > 0.04 && stats.peak < 1);
    const untouched = mixGusli(input, { ...plan, tracks: [{ program: 40 }] });
    assert.deepEqual(untouched, input);
});

test('mastering preserves dynamics with codec headroom and silent click-free loop endpoints', () => {
    const samples = Array.from(
        { length: 4000 },
        (_, index) => Math.sin(Math.floor(index / 2) * 0.17) * (index < 2000 ? 1.8 : 0.6),
    );
    const input = floatWave(samples);
    const result = masterWave(input);
    const stats = analyzeWave(result.wave);
    assert.ok(stats.peak <= 0.841 && stats.peak >= 0.83);
    assert.equal(stats.sampleRate, 1000);
    assert.equal(stats.channels, 2);
    assert.equal(stats.frames, 2000);
    assert.equal(result.wave.readInt16LE(44), 0);
    assert.equal(result.wave.readInt16LE(result.wave.length - 2), 0);
    assert.ok(stats.rms > 0.1 && stats.rms < stats.peak * 0.7);
    assert.deepEqual(masterWave(input).wave, result.wave);
});

test('silent and malformed PCM cannot introduce invalid or clipped samples', () => {
    const silence = masterWave(floatWave(Array(400).fill(0)));
    assert.equal(analyzeWave(silence.wave).peak, 0);
    assert.ok(Number.isFinite(silence.gain));
    assert.throws(() => analyzeWave(Buffer.from('not wave')), RangeError);
    assert.throws(() => masterWave(floatWave([NaN, 0, 0, 0])), RangeError);
});
