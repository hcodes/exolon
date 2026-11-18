import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGusliNote } from '../../tools/audio/gusli.mjs';

const energy = (samples: Float64Array) =>
    samples.reduce((total, sample) => total + sample * sample, 0) / samples.length;
function powerAt(samples: Float64Array, frequency: number, sampleRate: number) {
    let real = 0,
        imaginary = 0;
    samples.forEach((sample, index) => {
        const phase = (2 * Math.PI * frequency * index) / sampleRate;
        real += sample * Math.cos(phase);
        imaginary += sample * Math.sin(phase);
    });
    return real * real + imaginary * imaginary;
}
test('gusli has a pitched plucked attack, audible ring and a decaying release', () => {
    const sampleRate = 22050;
    const note = { note: 69, cents: 0, velocity: 95, seconds: 0, endSeconds: 0.7 };
    const samples = renderGusliNote(note, sampleRate);
    assert.deepEqual(renderGusliNote(note, sampleRate), samples);
    assert.equal(samples[0], 0);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(energy(samples.subarray(100, 2200)) > 0.001);
    assert.ok(energy(samples.subarray(100, 2200)) > energy(samples.subarray(15000, 17000)) * 2);
    assert.ok(energy(samples.subarray(-1000)) < energy(samples.subarray(100, 2200)) * 0.002);
    const excerpt = samples.subarray(100, 8000);
    assert.ok(powerAt(excerpt, 440, sampleRate) > powerAt(excerpt, 466.16, sampleRate) * 20);
    assert.ok(powerAt(excerpt, 880, sampleRate) > powerAt(excerpt, 915, sampleRate) * 5);
});

test('gusli retains source cents tuning and rejects invalid notes or rates', () => {
    const note = { note: 69, cents: 40, velocity: 95, seconds: 0, endSeconds: 0.5 };
    const samples = renderGusliNote(note, 22050).subarray(100, 12000);
    assert.ok(powerAt(samples, 440 * 2 ** (0.4 / 12), 22050) > powerAt(samples, 440, 22050) * 10);
    assert.throws(() => renderGusliNote(note, 0), RangeError);
    assert.throws(() => renderGusliNote({ ...note, endSeconds: -1 }, 22050), RangeError);
    assert.throws(() => renderGusliNote({ ...note, cents: NaN }, 22050), RangeError);
});
