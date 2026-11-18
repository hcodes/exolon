import { AY_CLOCK, EFFECT_RATE } from './decode.ts';

// AY-3-8910 measured DAC levels from Ayumi (Peter Sovietov, MIT license).
// https://github.com/true-grue/ayumi/blob/master/ayumi.c
// See LICENSE-ayumi.txt. Tone/noise counters run at AY_CLOCK / 8.
const DAC = [
    0, 0.00999465934234, 0.0144502937362, 0.0210574502174, 0.0307011520562, 0.0455481803616,
    0.0644998855573, 0.107362478065, 0.126588845655, 0.20498970016, 0.292210269322, 0.372838941024,
    0.492530708782, 0.635324635691, 0.805584802014, 1,
];

/** Render original register frames; no composed notes, ramps or random samples. */
export function renderAy(
    frames: readonly ArrayLike<number>[],
    sampleRate: number,
    frameRate = EFFECT_RATE,
    clock = AY_CLOCK,
) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
        throw new RangeError('Unsupported audio sample rate.');
    }
    if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('Unsupported AY clock.');
    const pcm = new Float32Array(Math.ceil((frames.length * sampleRate) / frameRate));
    if (!frames.length) return pcm;
    const counters = [0, 0, 0];
    const tones = [0, 0, 0];
    const periods = [1, 1, 1];
    const levels = [0, 0, 0];
    const toneOff = [0, 0, 0];
    const noiseOff = [0, 0, 0];
    const ticksPerSample = clock / 8 / sampleRate;
    const coupling = Math.exp((-2 * Math.PI * 20) / sampleRate);
    let previousFrame = -1;
    let noiseCounter = 0;
    let noisePeriod = 1;
    let noise = 1;
    let tickRemainder = 0;
    let chipOutput = 0;
    let previousInput = 0;
    let coupled = 0;
    for (let sample = 0; sample < pcm.length; sample++) {
        const frameIndex = Math.min(
            frames.length - 1,
            Math.floor((sample * frameRate) / sampleRate),
        );
        if (frameIndex !== previousFrame) {
            const registers = frames[frameIndex];
            for (let channel = 0; channel < 3; channel++) {
                periods[channel] =
                    (registers[channel * 2] | (registers[channel * 2 + 1] << 8)) & 4095 || 1;
                levels[channel] = DAC[registers[channel + 8] & 15];
                toneOff[channel] = (registers[7] >> channel) & 1;
                noiseOff[channel] = (registers[7] >> (channel + 3)) & 1;
            }
            noisePeriod = registers[6] & 31 || 1;
            previousFrame = frameIndex;
        }
        let remaining = ticksPerSample;
        let sum = 0;
        while (remaining > 0) {
            if (tickRemainder <= 0) {
                for (let channel = 0; channel < 3; channel++) {
                    if (++counters[channel] >= periods[channel]) {
                        counters[channel] = 0;
                        tones[channel] ^= 1;
                    }
                }
                if (++noiseCounter >= noisePeriod * 2) {
                    noiseCounter = 0;
                    const feedback = (noise ^ (noise >> 3)) & 1;
                    noise = (noise >> 1) | (feedback << 16);
                }
                chipOutput = 0;
                for (let channel = 0; channel < 3; channel++) {
                    if ((tones[channel] | toneOff[channel]) & ((noise & 1) | noiseOff[channel])) {
                        chipOutput += levels[channel] / 3;
                    }
                }
                tickRemainder = 1;
            }
            const part = Math.min(remaining, tickRemainder);
            sum += chipOutput * part;
            remaining -= part;
            tickRemainder -= part;
        }
        const input = sum / ticksPerSample;
        // AC coupling removes the chip's DC component without an invented envelope.
        coupled = input - previousInput + coupling * coupled;
        previousInput = input;
        pcm[sample] = coupled;
    }
    return pcm;
}
