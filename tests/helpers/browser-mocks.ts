// Minimal native interfaces implemented by the unit-test Web Audio transports.
export interface PcmBuffer {
    sampleRate: number;
    numberOfChannels?: number;
    getChannelData(channel: number): Float32Array;
}
export interface PcmSource {
    buffer: PcmBuffer;
    connect(): void;
    disconnect(): void;
    start(): void;
    stop(): void;
}
export interface AudioResponse {
    ok: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
}
interface AudioTransport {
    state: string;
    sampleRate: number;
    createGain(): { gain: { value: number }; connect(): void };
    createBuffer(channels: number, length: number, sampleRate: number): PcmBuffer;
    createBufferSource(): PcmSource;
    decodeAudioData(
        bytes: ArrayBuffer,
        resolve: (buffer: PcmBuffer) => void,
        reject?: (error: Error) => void,
    ): void | Promise<unknown>;
    resume(): Promise<void>;
    close(): Promise<void>;
}
// Node has no Window or Web Audio. This boundary describes exactly the globals
// replaced by these tests; the application still sees the original global object.
export const audioGlobals = globalThis as unknown as {
    window?: { AudioContext: new () => AudioTransport };
    fetch: (url: string | URL) => Promise<AudioResponse>;
};
