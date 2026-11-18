/** Offline port of the original title driver at $5da0e/$5dd92, not a MOD emulator. */
export const AMIGA_TITLE_TIMING = {
    paulaClock: 3546895,
    ciaClock: 709379,
    timerLatch: 0x3b88,
    ticksPerRow: 6,
} as const;

export interface AmigaInstrument {
    name: string;
    sourceOffset: number;
    initialBytes: number;
    volume: number;
    loopStart: number;
    loopBytes: number;
    data: Uint8Array;
}

export interface AmigaNote {
    period: number;
    instrument: number;
    effect: number;
    parameter: number;
}

export interface AmigaTitleSong {
    orders: number[];
    patternCount: number;
    instruments: AmigaInstrument[];
    rows: AmigaNote[][];
}

export function parseAmigaTitleBank(source: Uint8Array): AmigaTitleSong {
    if (source.length < 660) throw new Error('Incomplete Amiga title header.');
    const bytes = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const orderCount = source[530];
    if (!orderCount || orderCount > 128) throw new Error('Invalid Amiga title orders.');
    const orders = Array.from(source.subarray(532, 532 + orderCount));
    const patternCount = Math.max(...orders) + 1;
    let sampleOffset = 660 + patternCount * 1024;
    if (sampleOffset > source.length) throw new Error('Incomplete Amiga title patterns.');
    const instruments: AmigaInstrument[] = [];
    for (let index = 0; index < 15; index++) {
        const size = bytes.getUint32(index * 4);
        const header = 80 + index * 30;
        const initialBytes = bytes.getUint16(header + 22) * 2;
        const volume = bytes.getUint16(header + 24);
        const loopStart = bytes.getUint16(header + 26);
        const loopBytes = bytes.getUint16(header + 28) * 2;
        if (
            sampleOffset + size > source.length ||
            (size && (initialBytes > size || !loopBytes || loopStart + loopBytes > size))
        )
            throw new Error('Invalid Amiga sample bounds.');
        if (volume > 64) throw new Error('Invalid Amiga sample volume.');
        let name = '';
        for (let offset = header; offset < header + 22 && source[offset]; offset++)
            name += String.fromCharCode(source[offset]);
        const data = source.slice(sampleOffset, sampleOffset + size);
        // The original init at $5da9c clears each sample's first longword.
        data.fill(0, 0, Math.min(4, data.length));
        instruments.push({
            name,
            sourceOffset: sampleOffset,
            initialBytes,
            volume,
            loopStart,
            loopBytes,
            data,
        });
        sampleOffset += size;
    }
    const rows: AmigaNote[][] = [];
    for (const pattern of orders) {
        for (let row = 0; row < 64; row++) {
            const notes: AmigaNote[] = [];
            for (let channel = 0; channel < 4; channel++) {
                const offset = 660 + pattern * 1024 + row * 16 + channel * 4;
                const period = bytes.getUint16(offset);
                const instrument = source[offset + 2] >> 4;
                const effect = source[offset + 2] & 15;
                // This title uses only no-effect and filter-bypass (3).
                // Fail closed before applying this small port to other scores.
                if (effect !== 0 && effect !== 3)
                    throw new Error('Unsupported Amiga title effect.');
                if (period > 1076 && period !== 0xfffd && period !== 0xfffe)
                    throw new Error('Invalid Amiga title period.');
                notes.push({ period, instrument, effect, parameter: source[offset + 3] });
            }
            rows.push(notes);
        }
    }
    return { orders, patternCount, instruments, rows };
}

interface RenderOptions {
    sampleRate?: number;
    paulaClock?: number;
    tickSeconds?: number;
}

/** Sample-and-hold Paula output; analog filters and DMA bus delays are not simulated. */
export function renderAmigaTitle(song: AmigaTitleSong, options: RenderOptions = {}) {
    const sampleRate = options.sampleRate ?? 22050;
    const paulaClock = options.paulaClock ?? AMIGA_TITLE_TIMING.paulaClock;
    const tickSeconds =
        options.tickSeconds ?? (AMIGA_TITLE_TIMING.timerLatch + 1) / AMIGA_TITLE_TIMING.ciaClock;
    if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192000)
        throw new RangeError('Invalid sample rate.');
    if (
        !Number.isFinite(paulaClock) ||
        paulaClock <= 0 ||
        !Number.isFinite(tickSeconds) ||
        tickSeconds <= 0
    )
        throw new RangeError('Invalid Amiga render clock.');
    const rowSeconds = tickSeconds * AMIGA_TITLE_TIMING.ticksPerRow;
    const durationSeconds = song.rows.length * rowSeconds;
    const frames = Math.round(durationSeconds * sampleRate);
    const samples = new Int16Array(frames * 2);
    const channels = Array.from({ length: 4 }, () => ({
        instrument: null as AmigaInstrument | null,
        period: 0,
        position: 0,
        volume: 0,
        loop: false,
    }));
    let currentRow = -1;
    for (let frame = 0; frame < frames; frame++) {
        const row = Math.min(song.rows.length - 1, Math.floor(frame / sampleRate / rowSeconds));
        if (row !== currentRow) {
            currentRow = row;
            for (let index = 0; index < 4; index++) {
                const state = channels[index];
                const note = song.rows[row][index];
                if (note.instrument) {
                    state.instrument = song.instruments[note.instrument - 1];
                    state.volume = state.instrument.volume;
                }
                if (note.period === 0xfffe) state.volume = 0;
                else if (note.period && note.period !== 0xfffd) {
                    state.period = note.period;
                    state.position = 0;
                    state.loop = false;
                }
            }
        }
        for (let index = 0; index < 4; index++) {
            const state = channels[index];
            const instrument = state.instrument;
            if (!instrument?.data.length || !state.period) continue;
            const end = state.loop
                ? instrument.loopStart + instrument.loopBytes
                : instrument.initialBytes;
            if (state.position >= end) {
                state.position =
                    instrument.loopStart + ((state.position - end) % instrument.loopBytes);
                state.loop = true;
            }
            const byte = instrument.data[Math.floor(state.position)] ?? 0;
            const value = (byte < 128 ? byte : byte - 256) * state.volume * 2;
            // Original stereo: channels 0/3 left, 1/2 right; 1/2 gain avoids clipping.
            const target = frame * 2 + (index === 0 || index === 3 ? 0 : 1);
            samples[target] += value;
            state.position += paulaClock / state.period / sampleRate;
        }
    }
    return { samples, frames, durationSeconds, sampleRate };
}
