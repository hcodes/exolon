import { audioGlobals } from '../helpers/browser-mocks.ts';
import type { PcmBuffer, PcmSource } from '../helpers/browser-mocks.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio } from '../../src/view/audio.ts';

// Only the Web Audio transport is replaced; both PCM synthesis paths stay real.
function nativeTransport(started: PcmSource[], stopped: PcmSource[]) {
    return class {
        state = 'running';
        sampleRate = 44100;
        createGain() {
            return { gain: { value: 1 }, connect() {} };
        }
        createBuffer(channels: number, length: number, sampleRate: number) {
            const pcm = Array.from({ length: channels }, () => new Float32Array(length));
            return {
                numberOfChannels: channels,
                sampleRate,
                getChannelData: (channel: number) => pcm[channel],
            };
        }
        createBufferSource() {
            return {
                connect() {},
                disconnect() {},
                start() {
                    started.push(this);
                },
                stop() {
                    stopped.push(this);
                },
            } as PcmSource;
        }
        async resume() {}
        async close() {}
        decodeAudioData(_bytes: ArrayBuffer, resolve: (buffer: PcmBuffer) => void) {
            resolve(this.createBuffer(2, 44100, 44100));
        }
    };
}

test('graphics selects original or ambient music and stops the previous sound bank', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: PcmSource[] = [],
        stopped: PcmSource[] = [],
        requests: (string | undefined)[] = [];
    audioGlobals.window = { AudioContext: nativeTransport(started, stopped) };
    audioGlobals.fetch = async (url) => {
        requests.push(new URL(url).pathname.split('/').at(-1));
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio();
    try {
        await audio.unlock();
        await audio.loadMusic();
        audio.startMusic();
        assert.equal(audio.musicInfo!.kind, 'original');
        audio.handle([{ type: 'shot' }]);
        const originalShot = started.at(-1)!;
        audio.setGraphicsMode('remastered');
        assert.ok(stopped.includes(originalShot!));
        assert.ok(stopped.includes(started[0]));
        assert.equal(audio.startMusic(), false, 'A new mode cannot play the previous recording');
        await audio.loadMusic();
        audio.startMusic();
        assert.equal(audio.musicInfo!.kind, 'ambient');
        audio.handle([{ type: 'shot' }]);
        const modernShot = started.at(-1)!;
        assert.equal(originalShot!.buffer.numberOfChannels, 1);
        assert.equal(modernShot!.buffer.numberOfChannels, 2);
        assert.notDeepEqual(
            modernShot!.buffer.getChannelData(0),
            originalShot!.buffer.getChannelData(0),
        );
        audio.setGraphicsMode('retro');
        audio.handle([{ type: 'shot' }]);
        assert.equal(
            started.at(-1)!.buffer,
            originalShot!.buffer,
            'Return to the cached byte-identical Retro bank',
        );
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'original');
        assert.deepEqual(requests, ['title-128k.mp3', 'title-ambient.m4a', 'title-128k.mp3']);
    } finally {
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('every Remastered event has audible stereo PCM, headroom and a quiet release', async () => {
    const previousWindow = audioGlobals.window,
        started: PcmSource[] = [];
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    const audio = createAudio({ graphicsMode: 'remastered' });
    const events = [
        'shot',
        'grenade',
        'rocket',
        'explosion',
        'enemy-destroyed',
        'turret',
        'mine',
        'death',
        'teleport',
        'suit',
        'refill-ammo',
        'refill-grenades',
    ] as const;
    try {
        await audio.unlock();
        audio.handle(
            events.map((type) =>
                type.startsWith('refill-')
                    ? { type: 'refill', supply: type.slice(7) as 'ammo' | 'grenades' }
                    : { type },
            ),
        );
        assert.equal(started.length, events.length);
        for (const [index, source] of started.entries()) {
            const buffer = source.buffer,
                left = buffer.getChannelData(0),
                right = buffer.getChannelData(1);
            assert.equal(buffer.numberOfChannels, 2, events[index]);
            let peak = 0,
                energy = 0,
                difference = 0;
            for (let i = 0; i < left.length; i++) {
                assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
                peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
                energy += left[i] ** 2;
                difference += Math.abs(left[i] - right[i]);
            }
            assert.ok(peak > 0.1 && peak < 0.95 && energy / left.length > 0.0001, events[index]);
            assert.ok(difference / left.length > 0.0001, events[index]);
            assert.ok(
                Math.abs(left.at(-1)!) < 0.0001 && Math.abs(right.at(-1)!) < 0.0001,
                events[index],
            );
            assert.equal(left[0], 0, 'No abrupt onset');
        }
        assert.notDeepEqual(
            started[3].buffer.getChannelData(0),
            started[7].buffer.getChannelData(0),
            'Death has its own effect',
        );
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('Split uses one Remastered sound bank and the ambient title', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [];
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    const audio = createAudio({ graphicsMode: 'split' });
    try {
        await audio.unlock();
        await audio.loadMusic();
        audio.startMusic();
        audio.handle([{ type: 'shot' }]);
        assert.equal(audio.musicInfo!.kind, 'ambient');
        assert.equal(started.length, 2);
        assert.equal(started[1].buffer.numberOfChannels, 2);
        audio.setGraphicsMode('remastered');
        assert.equal(audio.startMusic(), true);
        assert.equal(started.length, 2, 'Remastered and Split share one title source');
    } finally {
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('C64 selects its own title and cancels delayed effects on pause', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [],
        requests: (string | undefined)[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async (url) => {
        requests.push(String(url));
        if (String(url).endsWith('/c64/shot.wav')) await held;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio({ graphicsMode: 'c64' });
    try {
        assert.equal(await audio.unlock(), true, 'Pending effect files cannot block audio unlock');
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'c64');
        assert.equal(audio.musicInfo!.file, 'c64/title.m4a');
        audio.handle([{ type: 'shot' }]);
        audio.stop();
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 0, 'A paused pending shot cannot sound late');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.ok(requests.some((url) => url!.endsWith('/c64/title.m4a')));
        assert.ok(!requests.some((url) => url!.endsWith('title-128k.mp3')));
        audio.setGraphicsMode('retro');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 2);
    } finally {
        release();
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('a pending C64 effect is cancelled by switching to another sound bank', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async () => {
        await held;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio({ graphicsMode: 'c64' });
    try {
        await audio.unlock();
        audio.handle([{ type: 'shot' }]);
        audio.setGraphicsMode('remastered');
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 0);
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 1);
        assert.equal(started[0].buffer.numberOfChannels, 2);
    } finally {
        release();
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('an unrelated stalled C64 recording cannot hold a ready effect or game-over tune', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async (url) => {
        if (String(url).endsWith('/turret.wav')) await held;
        return {
            ok: !/\/title\.(wav|m4a)$/.test(String(url)),
            arrayBuffer: async () => new ArrayBuffer(0),
        };
    };
    const audio = createAudio({ graphicsMode: 'c64' });
    try {
        await audio.unlock();
        audio.handle([{ type: 'shot' }, { type: 'game-over' }]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 2, 'Each pending event follows its own recording');
        assert.equal(await audio.loadMusic(), false, 'Missing title does not prevent effects');
        audio.handle([{ type: 'explosion' }]);
        assert.equal(started.length, 3);
    } finally {
        release();
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('CPC uses its own recording bank and cancels pending CPC playback after a switch', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [],
        requests: (string | undefined)[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async (url) => {
        requests.push(String(url));
        if (String(url).endsWith('/cpc/shot.wav')) await held;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio({ graphicsMode: 'cpc' });
    try {
        await audio.unlock();
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'cpc');
        assert.equal(audio.musicInfo!.file, 'cpc/title.m4a');
        audio.startMusic();
        audio.handle([{ type: 'shot' }]);
        audio.setGraphicsMode('c64');
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 1, 'The old CPC shot cannot sound in C64');
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'c64');
        assert.equal(audio.musicInfo!.file, 'c64/title.m4a');
        assert.ok(requests.some((url) => url!.endsWith('/cpc/title.m4a')));
        assert.ok(!requests.some((url) => url!.endsWith('title-128k.mp3')));
        audio.setGraphicsMode('cpc');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 2);
    } finally {
        release();
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('Game Boy selects the new chip arrangement and cancels a pending shot on pause', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [],
        requests: (string | undefined)[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async (url) => {
        requests.push(String(url));
        if (String(url).endsWith('/gameboy/shot.wav')) await held;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio({ graphicsMode: 'gameboy' });
    try {
        await audio.unlock();
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'gameboy');
        assert.equal(audio.musicInfo!.file, 'gameboy/title.m4a');
        audio.startMusic();
        audio.handle([{ type: 'shot' }]);
        audio.stop();
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 1, 'No late Game Boy shot after pause');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 2);
        assert.ok(requests.some((url) => url!.endsWith('/gameboy/title.m4a')));
        assert.ok(!requests.some((url) => url!.endsWith('title-128k.mp3')));
        audio.setGraphicsMode('retro');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.length, 3);
    } finally {
        release();
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('Game Boy Color shares the handheld sound bank without restarting on monochrome switches', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [],
        stopped: PcmSource[] = [];
    audioGlobals.window = { AudioContext: nativeTransport(started, stopped) };
    audioGlobals.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    const audio = createAudio({ graphicsMode: 'gameboy-color' });
    try {
        await audio.unlock();
        await audio.loadMusic();
        assert.equal(audio.musicInfo!.kind, 'gameboy');
        assert.equal(audio.musicInfo!.file, 'gameboy/title.m4a');
        audio.startMusic();
        audio.setGraphicsMode('gameboy');
        assert.equal(audio.startMusic(), true);
        assert.equal(started.length, 1);
        assert.equal(stopped.length, 0, 'The same handheld title continues');
        audio.handle([{ type: 'shot' }]);
        const shot = started.at(-1)!.buffer;
        audio.setGraphicsMode('gameboy-color');
        audio.handle([{ type: 'shot' }]);
        assert.equal(started.at(-1)!.buffer, shot);
        assert.equal(stopped.length, 0);
    } finally {
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});

test('classic title cache uses its directly requested M4A identity', async () => {
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch,
        started: PcmSource[] = [],
        requests: string[] = [];
    audioGlobals.window = { AudioContext: nativeTransport(started, []) };
    audioGlobals.fetch = async (url) => {
        requests.push(String(url));
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const audio = createAudio({ graphicsMode: 'c64' });
    try {
        await audio.unlock();
        assert.equal(await audio.loadMusic(), true);
        assert.equal(audio.startMusic(), true);
        const title = started[0].buffer;
        audio.setGraphicsMode('retro');
        await audio.loadMusic();
        audio.setGraphicsMode('c64');
        assert.equal(await audio.loadMusic(), true);
        assert.equal(audio.startMusic(), true);
        assert.equal(started.at(-1)!.buffer, title);
        assert.equal(audio.musicInfo!.file, 'c64/title.m4a');
        assert.equal(requests.filter((url) => url.endsWith('/c64/title.m4a')).length, 1);
        assert.equal(
            requests.some((url) => url.endsWith('/c64/title.wav')),
            false,
        );
    } finally {
        audio.destroy();
        audioGlobals.fetch = previousFetch;
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
    }
});
