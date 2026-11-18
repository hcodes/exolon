// Offline, deterministic modal approximation of plucked gusli strings.
// This is synthesis, not a recording of an acoustic performer or a GM harp.
export function renderGusliNote(note, sampleRate) {
    if (
        !Number.isFinite(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 192000 ||
        !Number.isInteger(note.note) ||
        note.note < 0 ||
        note.note > 127 ||
        !Number.isFinite(note.cents) ||
        !Number.isFinite(note.velocity) ||
        note.velocity < 1 ||
        note.velocity > 127 ||
        !Number.isFinite(note.seconds) ||
        !Number.isFinite(note.endSeconds) ||
        note.seconds < 0 ||
        note.endSeconds <= note.seconds
    ) {
        throw new RangeError('Invalid gusli note or sample rate.');
    }
    const frequency = 440 * 2 ** ((note.note - 69 + note.cents / 100) / 12);
    const held = note.endSeconds - note.seconds;
    const duration = Math.min(held + 0.8, 8);
    const samples = new Float64Array(Math.ceil(duration * sampleRate));
    const velocity = (note.velocity / 127) ** 1.2;
    function mode(frequency, amplitude, decay) {
        if (frequency >= sampleRate * 0.46) return;
        const radius = Math.exp(-1 / (decay * sampleRate));
        const cosine = Math.cos((2 * Math.PI * frequency) / sampleRate);
        const coefficient = 2 * radius * cosine,
            square = radius * radius;
        let previous = amplitude * velocity,
            older = (amplitude * velocity * cosine) / radius;
        for (let frame = 0; frame < samples.length; frame++) {
            const value = coefficient * previous - square * older;
            samples[frame] += value;
            older = previous;
            previous = value;
        }
    }
    // A pluck excites several modes at once. Upper wire modes decay faster;
    // slight stiffness detunes overtones while keeping the fundamental exact.
    for (let partial = 1; partial <= 12; partial++) {
        const stiffness = Math.sqrt((1 + 0.000025 * partial * partial) / 1.000025);
        const amplitude = (0.26 * Math.sin(Math.PI * 0.21 * partial)) / partial ** 1.15;
        mode(frequency * partial * stiffness, amplitude, 1.4 / (1 + 0.22 * (partial - 1)));
    }
    // Short, low-level wooden soundboard resonances colour the attack.
    mode(285, 0.012, 0.035);
    mode(630, 0.008, 0.025);
    for (let frame = 0; frame < samples.length; frame++) {
        const time = frame / sampleRate;
        const attack = Math.min(1, time / 0.0015);
        const damping = Math.exp(-Math.max(0, time - held) * 7);
        const end = Math.min(1, (samples.length - 1 - frame) / (sampleRate * 0.02));
        samples[frame] *= attack * damping * end;
    }
    return samples;
}
