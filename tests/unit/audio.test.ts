import { audioGlobals } from '../helpers/browser-mocks.ts';
import type { PcmBuffer, PcmSource, AudioResponse } from '../helpers/browser-mocks.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudio } from '../../src/view/audio.ts';
import type { MapObject } from '../../src/types/game.ts';
import { createState, step } from '../../src/model/state.ts';

const interactionScreen = (objects: MapObject[]) => ({
    id: 0,
    placements: [],
    actions: [],
    objects,
    tiles: Array.from({ length: 768 }, (_, index) =>
        index >= 576 ? { collision: 1, block: 33 } : null,
    ),
});

// Exercise lifecycle with an active title while retaining the original AY effects.
function createTitleAudio() {
    const audio = createAudio();
    audio.selectMusic('ambient');
    return audio;
}

// Native Web Audio is unavailable in Node; decoding and rendering stay real.
function audioContextFor(started: PcmBuffer[]) {
    return class AudioContext {
        state = 'running';
        sampleRate = 44100;
        createGain() {
            return { gain: { value: 1 }, connect() {} };
        }
        createBuffer(_channels: number, length: number, sampleRate: number) {
            const data = new Float32Array(length);
            return { sampleRate, getChannelData: () => data };
        }
        createBufferSource() {
            return {
                connect() {},
                disconnect() {},
                stop() {},
                start() {
                    started.push(this.buffer);
                },
            } as PcmSource;
        }
        decodeAudioData(_bytes: ArrayBuffer, resolve: (buffer: PcmBuffer) => void) {
            resolve(this.createBuffer(1, 44100, 44100));
        }
        async resume() {}
        async close() {
            this.state = 'closed';
        }
    };
}

test('audio has a separate title music lifecycle and works without browser audio', async () => {
    const audio = createTitleAudio();
    assert.equal(await audio.unlock(), false);
    assert.equal(await audio.loadMusic(), false);
    assert.equal(audio.startMusic(), false);
    audio.stopMusic();
    audio.stop();
    audio.destroy();
});

test('the active ambient title can be decoded and played', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [],
        requests: (string | undefined)[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = async (url) => {
        requests.push(new URL(url).pathname.split('/').at(-1));
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        assert.equal(await audio.loadMusic(), true);
        assert.equal(audio.startMusic(), true);
        assert.deepEqual(requests, ['title-ambient.m4a']);
        assert.equal(audio.musicInfo!.kind, 'ambient');
        assert.equal(started.length, 1);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('selecting a recording stops the old selection and loads the requested version first', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [],
        requests: (string | undefined)[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = async (url) => {
        requests.push(new URL(url).pathname.split('/').at(-1));
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createTitleAudio();
    try {
        await audio.unlock();
        await audio.loadMusic();
        audio.startMusic();
        assert.equal(audio.selectMusic('original'), true);
        assert.equal(audio.startMusic(), false);
        assert.equal(await audio.loadMusic(), true);
        assert.equal(audio.startMusic(), true);
        assert.equal(audio.musicInfo!.kind, 'original');
        assert.equal(audio.selectedMusic, 'original');
        assert.deepEqual(requests, ['title-ambient.m4a', 'title-128k.mp3']);
        assert.equal(audio.selectMusic('unknown'), false);
        assert.equal(audio.selectedMusic, 'original');
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('a late load from an earlier selection cannot replace the chosen recording', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    let finishOld!: (response: AudioResponse) => void;
    audioGlobals.window = { AudioContext: audioContextFor([]) };
    audioGlobals.fetch = async (url) => {
        if (new URL(url).pathname.endsWith('title-ambient.m4a'))
            return new Promise((resolve) => {
                finishOld = resolve;
            });
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createTitleAudio();
    try {
        await audio.unlock();
        const old = audio.loadMusic();
        audio.selectMusic('original');
        assert.equal(await audio.loadMusic(), true);
        finishOld({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
        assert.equal(await old, false);
        assert.equal(audio.musicInfo!.kind, 'original');
        assert.equal(audio.startMusic(), true);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('archived arrangements cannot be selected or requested by the runtime', () => {
    const audio = createTitleAudio();
    try {
        for (const kind of [
            'space-rock',
            'synthwave',
            'organ-lead',
            'guitar-lead',
            'gusli-lead',
            'violin-lead',
            'strings-winds',
            'orchestral',
        ])
            assert.equal(audio.selectMusic(kind), false, kind);
        assert.equal(audio.selectedMusic, 'ambient');
    } finally {
        audio.destroy();
    }
});

test('missing or corrupt ambient may use only the active original MP3 alternative', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    try {
        for (const failure of ['HTTP', 'decode']) {
            const requests: (string | undefined)[] = [],
                started: PcmBuffer[] = [];
            const Base = audioContextFor(started);
            audioGlobals.window = {
                AudioContext: class extends Base {
                    decodeAudioData(
                        bytes: ArrayBuffer,
                        resolve: (buffer: PcmBuffer) => void,
                        reject?: (error: Error) => void,
                    ) {
                        if (new Uint8Array(bytes)[0] === 1) {
                            reject?.(new Error('Corrupt ambient'));
                            return;
                        }
                        super.decodeAudioData(bytes, resolve);
                    }
                },
            };
            audioGlobals.fetch = async (url) => {
                const file = new URL(url).pathname.split('/').at(-1);
                requests.push(file);
                return {
                    ok: !(failure === 'HTTP' && file === 'title-ambient.m4a'),
                    arrayBuffer: async () =>
                        Uint8Array.of(file === 'title-ambient.m4a' ? 1 : 0).buffer,
                };
            };
            const audio = createTitleAudio();
            try {
                await audio.unlock();
                assert.equal(await audio.loadMusic(), true);
                assert.equal(audio.startMusic(), true);
                assert.equal(audio.musicInfo!.kind, 'original');
                assert.equal(audio.selectedMusic, 'ambient');
                assert.deepEqual(requests, ['title-ambient.m4a', 'title-128k.mp3']);
            } finally {
                audio.destroy();
            }
        }
    } finally {
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('autoplay cannot wait on blocked resume and can preload music before a later gesture', async () => {
    const previousWindow = audioGlobals.window;
    const previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    let gesture = false,
        resumeCalls = 0,
        fetchCalls = 0,
        releaseResume: (() => void) | undefined,
        timer: ReturnType<typeof setTimeout> | undefined;
    const BaseAudio = audioContextFor(started);
    audioGlobals.window = {
        AudioContext: class extends BaseAudio {
            state = 'suspended';
            resume() {
                resumeCalls++;
                if (!gesture)
                    return new Promise<void>((resolve) => {
                        releaseResume = resolve;
                    });
                this.state = 'running';
                return Promise.resolve();
            }
        },
    };
    audioGlobals.fetch = async () => {
        fetchCalls++;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createTitleAudio();
    try {
        const result = await Promise.race([
            audio.unlock({ autoplay: true }),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve('waiting for a gesture'), 100);
            }),
        ]);
        assert.equal(result, false);
        assert.equal(resumeCalls, 1);
        assert.equal(await audio.loadMusic(), true);
        assert.equal(fetchCalls, 1);
        assert.equal(audio.startMusic(), false);
        assert.equal(started.length, 0);
        gesture = true;
        assert.equal(await audio.unlock(), true);
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.equal(audio.startMusic(), true);
        assert.equal(audio.startMusic(), true);
        assert.equal(started.length, 2);
        assert.equal(fetchCalls, 1);
    } finally {
        clearTimeout(timer);
        audio.destroy();
        releaseResume?.();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('autoplay reports an already running context without awaiting its resume promise', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    const BaseAudio = audioContextFor(started);
    let releaseResume: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    audioGlobals.window = {
        AudioContext: class extends BaseAudio {
            resume() {
                return new Promise<void>((resolve) => {
                    releaseResume = resolve;
                });
            }
        },
    };
    const audio = createTitleAudio();
    try {
        const result = await Promise.race([
            audio.unlock({ autoplay: true }),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve('waiting despite running audio'), 100);
            }),
        ]);
        assert.equal(result, true);
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.equal(audio.startMusic(), false);
    } finally {
        clearTimeout(timer);
        audio.destroy();
        releaseResume?.();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('cached title music starts once when an allowed autoplay resume becomes ready later', async () => {
    const previousWindow = audioGlobals.window;
    const previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    const BaseAudio = audioContextFor(started);
    let suspendContext!: () => void,
        deferResume = false,
        releaseResume!: () => void,
        fetchCalls = 0,
        readyCalls = 0;
    audioGlobals.window = {
        AudioContext: class extends BaseAudio {
            constructor() {
                super();
                suspendContext = () => {
                    this.state = 'suspended';
                };
            }
            resume() {
                if (!deferResume) return Promise.resolve();
                return new Promise<void>((resolve) => {
                    releaseResume = () => {
                        this.state = 'running';
                        resolve();
                    };
                });
            }
        },
    };
    audioGlobals.fetch = async () => {
        fetchCalls++;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        assert.equal(await audio.loadMusic(), true);
        suspendContext();
        deferResume = true;
        let loaded = false;
        assert.equal(
            await audio.unlock({
                autoplay: true,
                onReady() {
                    readyCalls++;
                    if (loaded) audio.startMusic();
                },
            }),
            false,
        );
        loaded = await audio.loadMusic();
        assert.equal(loaded, true);
        assert.equal(fetchCalls, 1);
        assert.equal(audio.startMusic(), false);
        assert.equal(readyCalls, 0);
        releaseResume();
        await Promise.resolve();
        assert.equal(readyCalls, 1);
        assert.equal(started.length, 1);
    } finally {
        audio.destroy();
        releaseResume?.();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('autoplay readiness does not run after destruction or while the context remains suspended', async () => {
    const previousWindow = audioGlobals.window;
    const BaseAudio = audioContextFor([]);
    let releaseResume!: (running: boolean) => void,
        readyCalls = 0;
    audioGlobals.window = {
        AudioContext: class extends BaseAudio {
            state = 'suspended';
            resume() {
                return new Promise<void>((resolve) => {
                    releaseResume = (running: boolean) => {
                        if (running) this.state = 'running';
                        resolve();
                    };
                });
            }
        },
    };
    const audio = createTitleAudio();
    try {
        assert.equal(
            await audio.unlock({
                autoplay: true,
                onReady() {
                    readyCalls++;
                },
            }),
            false,
        );
        releaseResume(false);
        await Promise.resolve();
        assert.equal(readyCalls, 0);
        assert.equal(
            await audio.unlock({
                autoplay: true,
                onReady() {
                    readyCalls++;
                },
            }),
            false,
        );
        audio.destroy();
        releaseResume(true);
        await Promise.resolve();
        assert.equal(readyCalls, 0);
    } finally {
        audio.destroy();
        releaseResume?.(true);
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('a rejected autoplay resume stays recoverable through the normal gesture unlock', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    const BaseAudio = audioContextFor(started);
    let gesture = false,
        readyCalls = 0;
    audioGlobals.window = {
        AudioContext: class extends BaseAudio {
            state = 'suspended';
            resume() {
                if (!gesture) return Promise.reject(new Error('Gesture required'));
                this.state = 'running';
                return Promise.resolve();
            }
        },
    };
    const audio = createTitleAudio();
    try {
        assert.equal(
            await audio.unlock({
                autoplay: true,
                onReady() {
                    readyCalls++;
                },
            }),
            false,
        );
        gesture = true;
        assert.equal(await audio.unlock(), true);
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.equal(readyCalls, 0);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('pending title loading cannot block effect unlock or automatically start music', async () => {
    const previousWindow = audioGlobals.window;
    const previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    let releaseFetch!: () => void;
    const promptly = async <T>(promise: Promise<T>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise((resolve) => {
                    timer = setTimeout(() => resolve('blocked by title request'), 100);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = () =>
        new Promise((resolve) => {
            releaseFetch = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
        });
    const audio = createTitleAudio();
    try {
        assert.equal(await promptly(audio.unlock()), true);
        const loading = audio.loadMusic();
        assert.equal(await promptly(audio.unlock()), true);
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.ok(started[0].getChannelData(0).some((value) => value > 0));
        releaseFetch();
        assert.equal(await loading, true);
        assert.equal(started.length, 1); // Loading alone cannot resurrect title playback.
        assert.equal(audio.startMusic(), true);
        assert.equal(started.length, 2);
    } finally {
        audio.destroy();
        releaseFetch?.();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('native enemy, mine and rocket events play their recovered PCM buffers', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        audio.handle([
            { type: 'enemy-destroyed' },
            { type: 'mine' },
            { type: 'rocket' },
            { type: 'explosion' },
        ]);
        assert.equal(started.length, 4);
        // At 50 Hz: C33E lasts 10 frames, C305 44, and C2C7 33.
        assert.deepEqual(
            started.map((buffer) => buffer.getChannelData(0).length),
            [8820, 38808, 29106, 38808],
        );
        assert.equal(started[1], started[3]); // Mine uses the existing original explosion buffer.
        assert.ok(started.every((buffer) => buffer.getChannelData(0).some((value) => value > 0)));
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('real teleport event batches play once and held jump or arrival cannot repeat the sound', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        let state = createState(
            interactionScreen([
                { id: 0, type: 6, x: 5, y: 13, instance: 0 },
                { id: 1, type: 6, x: 20, y: 13, instance: 1 },
            ]),
        );
        let result = step(state, { jump: true });
        assert.deepEqual(
            result.events.map((event) => event.type),
            ['teleport', 'teleport-arrive'],
        );
        audio.handle(result.events);
        assert.equal(started.length, 1);
        assert.equal(started[0].getChannelData(0).length, 65268); // C462: 74 driver steps.
        assert.ok(started[0].getChannelData(0).some((value) => value > 0));
        state = result.state;
        for (let i = 0; i < 10; i++) {
            result = step(state, { jump: true });
            audio.handle(result.events);
            state = result.state;
        }
        audio.handle([{ type: 'teleport-arrive' }]);
        assert.equal(started.length, 1);
        state = step(state, {}).state;
        result = step(state, { jump: true });
        audio.handle(result.events);
        assert.equal(started.length, 2);
        assert.equal(started[0], started[1]);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('real ammo and grenade pickups play distinct original sounds once after consumption', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        for (const [type, supply] of [
            [7, 'ammo'],
            [8, 'grenades'],
        ] as const) {
            let state = createState(interactionScreen([{ id: 0, type, x: 5, y: 16, instance: 0 }]));
            state[supply] = 1;
            let result = step(state, { duck: true });
            assert.deepEqual(
                result.events.map((event) => [event.type, event.supply]),
                [['refill', supply]],
            );
            audio.handle(result.events);
            assert.equal(result.state[supply], supply === 'ammo' ? 99 : 10);
            state = result.state;
            for (let i = 0; i < 10; i++) {
                result = step(state, { duck: true });
                audio.handle(result.events);
                state = result.state;
            }
        }
        assert.equal(started.length, 2);
        assert.deepEqual(
            started.map((buffer) => buffer.getChannelData(0).length),
            [64386, 64386],
        );
        assert.notDeepEqual(started[0].getChannelData(0), started[1].getChannelData(0));
        assert.ok(started.every((buffer) => buffer.getChannelData(0).some((value) => value > 0)));
        audio.handle([{ type: 'refill' }, { type: 'refill', supply: 'unknown' }]);
        assert.equal(started.length, 2);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('real suit toggles reuse the original white box sound only on fresh jump presses', async () => {
    const previousWindow = audioGlobals.window;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    const audio = createTitleAudio();
    try {
        assert.equal(await audio.unlock(), true);
        const pickup = step(
            createState(interactionScreen([{ id: 0, type: 7, x: 5, y: 16, instance: 0 }])),
            {},
        );
        audio.handle(pickup.events);
        let state = createState(interactionScreen([{ id: 0, type: 12, x: 5, y: 13, instance: 0 }]));
        let result = step(state, { jump: true });
        assert.equal(result.state.exoskeleton, true);
        audio.handle(result.events);
        assert.equal(started.length, 2);
        assert.equal(started[0], started[1]);
        state = result.state;
        for (let i = 0; i < 10; i++) {
            result = step(state, { jump: true });
            audio.handle(result.events);
            state = result.state;
        }
        assert.equal(started.length, 2);
        state = step(state, {}).state;
        result = step(state, { jump: true });
        assert.equal(result.state.exoskeleton, false);
        audio.handle(result.events);
        assert.equal(started.length, 3);
        assert.equal(started[0], started[2]);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('original AY shot keeps its encoded noise and volume sequence', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const frames = decodeEffect('shot');
    // FB 0F also plays note 15. The last note inherits duration 3 from 74 03.
    assert.equal(frames.length, 12);
    assert.deepEqual(
        frames
            .slice(0, 9)
            .map((frame) => [frame[0] | (frame[1] << 8), frame[6], frame[7] & 9, frame[8]]),
        [
            [1607, 15, 0, 13],
            [1204, 15, 0, 13],
            [1204, 15, 0, 11],
            [1204, 15, 0, 9],
            [1204, 15, 0, 7],
            [1204, 15, 0, 3],
            [1204, 15, 0, 3],
            [1204, 15, 0, 3],
            [1204, 15, 0, 2],
        ],
    );
    assert.equal(frames.at(-1)![7] & 0x3f, 0x3f);
});

test('original destruction sound follows C305 descending tones and noise 31', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const frames = decodeEffect('explosion');
    assert.equal(frames[0][6], 31);
    assert.equal(frames[0][8], 15);
    assert.deepEqual(
        frames.slice(0, 7).map((frame) => frame[0] | (frame[1] << 8)),
        [638, 379, 379, 402, 402, 426, 426],
    );
    assert.equal(frames.at(-2)![8], 1);
    assert.equal(frames.at(-1)![7] & 0x3f, 0x3f);
});

test('enemy destruction follows original C33E tone and volume steps', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const frames = decodeEffect('enemy-destroyed');
    assert.equal(frames.length, 10);
    assert.deepEqual(
        frames.slice(0, 9).map((frame) => [frame[0] | (frame[1] << 8), frame[6], frame[8]]),
        [
            [0, 0, 15],
            [213, 0, 14],
            [239, 0, 13],
            [268, 0, 12],
            [301, 0, 11],
            [338, 0, 9],
            [379, 0, 7],
            [426, 0, 5],
            [478, 0, 3],
        ],
    );
    assert.equal(frames.at(-1)![7] & 0x3f, 0x3f);
});

test('rocket launch preserves C2C7 noise sweep and mine uses original C305', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const frames = decodeEffect('rocket');
    assert.equal(frames.length, 33);
    assert.equal(frames[0][7], 0xb7); // Original FC 07 enables noise with tone disabled.
    assert.deepEqual(
        [0, 2, 4, 24, 26, 28, 30].map((index) => [frames[index][6], frames[index][8]]),
        [
            [0, 14],
            [2, 14],
            [4, 14],
            [24, 8],
            [26, 6],
            [28, 4],
            [30, 2],
        ],
    );
    assert.deepEqual(decodeEffect('mine'), decodeEffect('explosion'));
});

test('teleport and pickup decoders preserve original register prefixes and durations', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const teleport = decodeEffect('teleport');
    assert.equal(teleport.length, 74);
    assert.deepEqual(
        teleport.slice(0, 7).map((frame) => [frame[0] | (frame[1] << 8), frame[7], frame[8]]),
        [
            [119, 0xb6, 15],
            [119, 0xb6, 14],
            [119, 0xb6, 13],
            [119, 0xb6, 12],
            [119, 0xb6, 15],
            [900, 0xb6, 15],
            [119, 0xb6, 14],
        ],
    );
    const ammo = decodeEffect('refill-ammo');
    const grenades = decodeEffect('refill-grenades');
    assert.equal(ammo.length, 73);
    assert.equal(grenades.length, 73);
    assert.deepEqual(
        [0, 3, 6, 9, 12].map((index) => [
            ammo[index][0] | (ammo[index][1] << 8),
            ammo[index][7],
            ammo[index][8],
        ]),
        [
            [40, 0xbe, 13],
            [63, 0xbe, 13],
            [100, 0xbe, 13],
            [159, 0xbe, 13],
            [40, 0xbe, 11],
        ],
    );
    assert.deepEqual(
        [0, 3, 6, 9, 12].map((index) => [
            grenades[index][0] | (grenades[index][1] << 8),
            grenades[index][7],
            grenades[index][8],
        ]),
        [
            [30, 0xbe, 13],
            [47, 0xbe, 13],
            [75, 0xbe, 13],
            [119, 0xbe, 13],
            [30, 0xbe, 11],
        ],
    );
    assert.deepEqual(decodeEffect('suit'), ammo);
});

test('title recording is the unchanged original World of Spectrum archive track', async () => {
    const bytes = await readFile(new URL('../../src/audio/title-128k.mp3', import.meta.url));
    assert.equal(bytes.length, 1167778);
    assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        'cbf6a2e5c15e17a769d6c3577c6d7381a54d5f9f7d4280e1f678c36b016bd1c6',
    );
});

test('grenade preserves both original AY voices instead of a single substitute tone', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const frames = decodeEffect('grenade');
    // C366 and C3D8 begin at notes 79 and 59, enabled on tone channels A and B.
    assert.equal(frames.length, 69);
    assert.deepEqual(Array.from(frames[0]), [40, 0, 127, 0, 0, 0, 0, 0xbc, 1, 1, 0]);
    assert.equal(frames[7][8], 15);
    assert.equal(frames[7][9], 15);
});

test('AY PCM is deterministic and preserves a hardware square wave frequency', async () => {
    const { renderAy } = await import('../../src/audio/synthesize.ts');
    const frame = Uint8Array.from([100, 0, 0, 0, 0, 0, 0, 0x3e, 15, 0, 0]);
    const pcm = renderAy(
        Array.from({ length: 5 }, () => frame),
        44100,
        50,
    );
    assert.equal(pcm.length, 4410);
    // AY clock / (16 * tone period) = 1108.40625 Hz.
    let rises = 0;
    for (let i = 1; i < pcm.length; i++) if (pcm[i - 1] <= 0 && pcm[i] > 0) rises++;
    assert.ok(rises >= 110 && rises <= 112, String(rises));
    assert.equal(
        createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex'),
        createHash('sha256')
            .update(
                Buffer.from(
                    renderAy(
                        Array.from({ length: 5 }, () => frame),
                        44100,
                        50,
                    ).buffer,
                ),
            )
            .digest('hex'),
    );
    assert.ok(pcm.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
});

test('explosion PCM contains changing noise rather than an invented oscillator ramp', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const { renderAy } = await import('../../src/audio/synthesize.ts');
    const pcm = renderAy(decodeEffect('explosion'), 22050);
    assert.ok(pcm.length > 10000);
    assert.ok(pcm.some((value) => value > 0.1));
    assert.ok(pcm.some((value) => value < -0.1));
    const a = createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex');
    const b = createHash('sha256')
        .update(Buffer.from(renderAy(decodeEffect('explosion'), 22050).buffer))
        .digest('hex');
    assert.equal(a, b);
});

test('audio rendering rejects invalid sample rates and unknown effect names', async () => {
    const { decodeEffect } = await import('../../src/audio/decode.ts');
    const { renderAy } = await import('../../src/audio/synthesize.ts');
    assert.throws(() => decodeEffect('invented'), RangeError);
    assert.throws(() => renderAy([], 0), RangeError);
    assert.throws(() => renderAy([], Infinity), RangeError);
    assert.equal(renderAy([], 44100).length, 0);
});

test('audio extraction preserves source bytes at both range boundaries and rejects incomplete memory', async () => {
    const { extractOriginalAudio } = await import('../../tools/audio/zx.mjs');
    const memory = new Uint8Array(65536);
    memory.set([0xfe, 13, 0xaf], 0xc218);
    memory[0xc5e6] = 0xff;
    memory.set([0, 0, 0x84, 3], 0xc6eb);
    memory[0xc7aa] = 0x55;
    const source = extractOriginalAudio(memory);
    const generated = await import(
        `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    );
    assert.deepEqual(
        [
            generated.originalByte(0xc218),
            generated.originalByte(0xc219),
            generated.originalByte(0xc5e6),
            generated.originalByte(0xc6ed),
            generated.originalByte(0xc6ee),
            generated.originalByte(0xc7aa),
        ],
        [0xfe, 13, 0xff, 0x84, 3, 0x55],
    );
    assert.throws(() => generated.originalByte(0xc5e7), RangeError);
    assert.throws(() => generated.originalByte(0xc7ab), RangeError);
    assert.throws(() => extractOriginalAudio(memory.subarray(0, 100)), /65536/);
});

test('AY recordings support the original CPC 1MHz clock while preserving the ZX default', async () => {
    const { renderAy } = await import('../../src/audio/synthesize.ts');
    const { AY_CLOCK } = await import('../../src/audio/decode.ts');
    const registers = Array(16).fill(0);
    registers[0] = 100;
    registers[7] = 0x3e;
    registers[8] = 15;
    const frames = Array.from({ length: 10 }, () => registers);
    const zx = renderAy(frames, 44100),
        cpc = renderAy(frames, 44100, 50, 1000000);
    assert.deepEqual(zx, renderAy(frames, 44100, 50, AY_CLOCK));
    const frequency = (samples: Float32Array) => {
        let crossings = 0;
        const start = 4410;
        for (let i = start + 1; i < samples.length; i++)
            if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
        return (crossings * 44100) / (samples.length - start);
    };
    assert.ok(Math.abs(frequency(cpc) - 625) < 20, `CPC tone is ${frequency(cpc)}Hz`);
    assert.ok(Math.abs(frequency(zx) - AY_CLOCK / 1600) < 20);
    assert.throws(() => renderAy(frames, 44100, 50, 0), RangeError);
});

test('a deferred classic game adopts and closes the context unlocked by its selection gesture', async () => {
    const previousWindow = audioGlobals.window;
    const Transport = audioContextFor([]);
    const unlocked = new Transport();
    class ForbiddenSecondContext extends Transport {
        constructor() {
            super();
            throw new Error('The game must reuse the gesture context');
        }
    }
    audioGlobals.window = { AudioContext: ForbiddenSecondContext };
    const audio = createAudio({ context: unlocked as unknown as AudioContext });
    try {
        assert.equal(await audio.unlock(), true);
        audio.setVolume(0.2);
        audio.destroy();
        assert.equal(unlocked.state, 'closed');
    } finally {
        audio.destroy();
        audioGlobals.window = previousWindow;
    }
});

test('original cheat sounds use the requested left platform without replacing title music', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [],
        requests: string[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = async (url) => {
        requests.push(new URL(url).pathname);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio();
    try {
        await audio.unlock();
        assert.equal(await audio.playCheatConfirmation('retro'), true);
        assert.equal(await audio.playCheatConfirmation('cpc'), true);
        assert.equal(await audio.playCheatConfirmation('sharp-mz800'), false);
        assert.equal(await audio.playCheatConfirmation('gameboy'), false);
        assert.equal(started.length, 2);
        assert.ok(requests[0].endsWith('/zx-spectrum/cheat-enabled.wav'));
        assert.ok(requests[1].endsWith('/cpc/game-over.m4a'));
        assert.equal(audio.selectedMusic, 'original');
        audio.setVolume(0);
        assert.equal(await audio.playCheatConfirmation('retro'), false);
        assert.equal(started.length, 2);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('ZX game over plays the original beeper recording shared with ZORBA once per event', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [],
        requests: string[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = async (url) => {
        requests.push(new URL(url).pathname);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio();
    try {
        await audio.unlock();
        assert.equal(requests.length, 0, 'ZX recordings load only when requested');
        audio.handle([{ type: 'game-over' }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(started.length, 1);
        assert.ok(requests[0].endsWith('/zx-spectrum/cheat-enabled.wav'));
        assert.equal(await audio.playCheatConfirmation('retro'), true);
        assert.equal(started[0], started[1], 'original calls share the same decoded recording');
        assert.equal(requests.length, 1);
        audio.handle([{ type: 'game-over' }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(started.length, 3);
        assert.equal(audio.selectedMusic, 'original');
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('pending ZX game over cannot play after stop, mute, graphics changes or disposal', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    try {
        for (const cancel of ['stop', 'mute', 'graphics', 'destroy']) {
            let resolveFetch!: (value: AudioResponse) => void;
            audioGlobals.fetch = () => new Promise((resolve) => (resolveFetch = resolve));
            const audio = createAudio();
            await audio.unlock();
            audio.handle([{ type: 'game-over' }]);
            assert.equal(typeof resolveFetch, 'function', cancel);
            if (cancel === 'stop') audio.stop();
            else if (cancel === 'mute') audio.setVolume(0);
            else if (cancel === 'graphics') audio.setGraphicsMode('remastered');
            else audio.destroy();
            resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(started.length, 0, cancel);
            audio.destroy();
        }
    } finally {
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('ZX game over still plays when its first recording takes over a second to load', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    const Transport = audioContextFor(started);
    const context = new (class extends Transport {
        currentTime = 0;
    })();
    let resolveFetch!: (value: AudioResponse) => void;
    audioGlobals.window = { AudioContext: Transport };
    audioGlobals.fetch = () => new Promise((resolve) => (resolveFetch = resolve));
    const audio = createAudio({ context: context as unknown as AudioContext });
    try {
        await audio.unlock();
        audio.handle([{ type: 'game-over' }]);
        context.currentTime = 2;
        resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(started.length, 1, 'Game Over remains eligible after download/decode');
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('failed ZX game over loading can retry on the next event', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    let requests = 0;
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    audioGlobals.fetch = async () => {
        if (++requests === 1) throw new Error('Recording temporarily unavailable');
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio();
    try {
        await audio.unlock();
        audio.handle([{ type: 'game-over' }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(requests, 1);
        assert.equal(started.length, 0);
        audio.handle([{ type: 'game-over' }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(requests, 2);
        assert.equal(started.length, 1);
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});

test('late cheat recordings cannot play after cancellation, graphics changes or disposal', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmBuffer[] = [];
    audioGlobals.window = { AudioContext: audioContextFor(started) };
    try {
        for (const cancel of ['disable', 'graphics', 'destroy']) {
            let resolveFetch!: (value: AudioResponse) => void;
            audioGlobals.fetch = () => new Promise((resolve) => (resolveFetch = resolve));
            const audio = createAudio();
            await audio.unlock();
            const loading = audio.playCheatConfirmation('retro');
            if (cancel === 'disable') audio.stopCheatConfirmation();
            else if (cancel === 'graphics') audio.setGraphicsMode('remastered');
            else audio.destroy();
            resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
            assert.equal(await loading, false, cancel);
            audio.destroy();
        }
        assert.equal(started.length, 0);
    } finally {
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});
