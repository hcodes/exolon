// Original electronic sound design for the Remastered presentation. Deterministic
// PCM keeps playback inexpensive and works through the existing Web Audio path.
const DURATIONS: Record<string, number> = {
    shot: 0.2,
    grenade: 0.38,
    rocket: 0.72,
    explosion: 1.05,
    'enemy-destroyed': 0.4,
    turret: 0.32,
    mine: 0.88,
    death: 1,
    teleport: 1.25,
    'refill-ammo': 0.48,
    'refill-grenades': 0.62,
    suit: 0.75,
};
const TAU = Math.PI * 2;

export function renderRemasteredEffect(
    name: string,
    sampleRate: number,
): [Float32Array, Float32Array] | null {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
        throw new RangeError('Unsupported audio sample rate.');
    const duration = DURATIONS[name];
    if (!duration) return null;
    const length = Math.ceil((duration + 0.24) * sampleRate),
        dry = new Float32Array(length);
    let seed = Array.from(name).reduce(
        (sum, character) => (Math.imul(sum, 31) + character.charCodeAt(0)) | 0,
        5381,
    );
    let lowNoise = 0,
        phase = 0;
    const noiseRate = 1 - Math.exp((-TAU * (name === 'shot' ? 3600 : 1700)) / sampleRate);
    for (let i = 0; i < Math.ceil(duration * sampleRate); i++) {
        const t = i / sampleRate,
            u = t / duration;
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const noise = (seed >>> 0) / 2147483648 - 1;
        lowNoise += noiseRate * (noise - lowNoise);
        const attack = Math.min(1, t / 0.003),
            release = Math.min(1, (duration - t) / 0.05);
        let value;
        if (name === 'shot' || name === 'turret') {
            const heavy = name === 'turret';
            const frequency = (heavy ? 950 : 2100) * Math.exp(-u * 6) + (heavy ? 85 : 170);
            phase += (TAU * frequency) / sampleRate;
            value =
                (Math.sin(phase + 0.7 * Math.sin(phase * 1.97) * (1 - u)) * 0.62 +
                    lowNoise * Math.exp(-t * 65) * 0.5) *
                Math.exp(-u * 5);
        } else if (['explosion', 'mine', 'enemy-destroyed', 'death'].includes(name)) {
            const small = name === 'enemy-destroyed',
                death = name === 'death';
            phase += (TAU * ((small ? 135 : 85) * Math.exp(-u * 5) + 29)) / sampleRate;
            value =
                Math.tanh(lowNoise * 3) * 0.62 * Math.exp(-u * 4) +
                Math.sin(phase) * 0.48 * Math.exp(-u * 6) +
                noise * 0.12 * Math.exp(-t * 40);
            if (death) value += Math.sin(TAU * (380 * t - 125 * t * t)) * Math.exp(-u * 3) * 0.28;
        } else if (name === 'rocket' || name === 'grenade') {
            phase += (TAU * (55 + 130 * Math.exp(-u * 7))) / sampleRate;
            value =
                (lowNoise * (1.1 - 0.5 * u) + Math.sin(phase) * 0.24) *
                Math.exp(-u * 3) *
                Math.min(1, t / 0.018);
        } else if (name === 'teleport') {
            phase += (TAU * (220 + 1150 * Math.sin(Math.PI * u) ** 2)) / sampleRate;
            const envelope = Math.sin(Math.PI * u) ** 1.6;
            value =
                (Math.sin(phase + Math.sin(phase * 0.501) * 1.3) * 0.38 +
                    Math.sin(phase * 1.003 + 0.5) * 0.22 +
                    lowNoise * 0.32) *
                envelope;
        } else {
            const notes =
                name === 'refill-ammo'
                    ? [659.25, 830.61, 987.77]
                    : name === 'refill-grenades'
                      ? [392, 523.25, 783.99]
                      : [261.63, 329.63, 392, 523.25];
            value = 0;
            for (let note = 0; note < notes.length; note++) {
                const age = t - note * 0.085;
                if (age < 0) continue;
                const frequency = notes[note];
                value +=
                    (Math.sin(TAU * frequency * age) + Math.sin(TAU * frequency * 2 * age) * 0.17) *
                    Math.exp(-age * 11) *
                    Math.min(1, age / 0.004) *
                    0.34;
            }
        }
        dry[i] = value * attack * release;
    }
    const left = new Float32Array(length),
        right = new Float32Array(length);
    const tap = (i: number, seconds: number) => dry[i - Math.round(seconds * sampleRate)] || 0;
    let peak = 0;
    for (let i = 0; i < length; i++) {
        const fade = Math.min(1, (length - 1 - i) / (0.025 * sampleRate));
        left[i] =
            (dry[i] * 0.84 + tap(i, 0.023) * 0.2 + tap(i, 0.079) * 0.12 + tap(i, 0.139) * 0.06) *
            fade;
        right[i] =
            (dry[i] * 0.84 + tap(i, 0.037) * 0.2 + tap(i, 0.097) * 0.12 + tap(i, 0.173) * 0.06) *
            fade;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    const gain = peak > 0 ? 0.78 / peak : 0;
    for (let i = 0; i < length; i++) {
        left[i] *= gain;
        right[i] *= gain;
    }
    return [left, right];
}
