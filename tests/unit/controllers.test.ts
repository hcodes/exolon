import assert from 'node:assert/strict';
import test from 'node:test';
import { createScoreController } from '../../src/controllers/scores.ts';
import { createMusicController } from '../../src/controllers/music.ts';
import { canvasPoint } from '../../src/utils/canvas.ts';
import { readObject, readGraphicsMode } from '../../src/utils/settings.ts';

function memoryStorage(available = true) {
    const values = new Map<string, string>();
    return {
        values,
        get: (key: string) => values.get(key) ?? null,
        set(key: string, value: unknown) {
            if (!available) return false;
            values.set(key, String(value));
            return true;
        },
    };
}

test('named scores survive a controller restart and merge a newer table from another tab', () => {
    const storage = memoryStorage(),
        scores = createScoreController(storage);
    scores.save({ score: 5000 });
    scores.submit('ace', { score: 5000 });
    const other = createScoreController(storage);
    other.save({ score: 7000 });
    other.submit('bob', { score: 7000 });
    scores.save({ score: 3000 });
    scores.submit('cat', { score: 3000 });
    const restored = createScoreController(storage);
    assert.deepEqual(
        restored.rows.slice(0, 3).map((row) => [row.name, row.score]),
        [
            ['BOB', 7000],
            ['ACE', 5000],
            ['CAT', 3000],
        ],
    );
    assert.equal(restored.bestScore, 7000);
    assert.equal(restored.playerName, 'CAT');
});

test('cheat sessions save a nickname and enter local rankings with a new personal best', () => {
    const storage = memoryStorage(),
        scores = createScoreController(storage);
    scores.save({ score: 5000 });
    scores.submit('ace', { score: 5000 });
    scores.save({ score: 999999, cheatUsed: true });
    scores.submit('cheater', { score: 999999, cheatUsed: true });
    const restored = createScoreController(storage);
    assert.equal(restored.bestScore, 999999);
    assert.equal(restored.playerName, 'CHEATER');
    assert.deepEqual(
        restored.rows.slice(0, 2).map((row) => [row.name, row.score]),
        [
            ['CHEATER', 999999],
            ['ACE', 5000],
        ],
    );
});

test('blocked storage retains multiple scores for this tab', () => {
    const scores = createScoreController(memoryStorage(false));
    scores.save({ score: 5000 });
    assert.equal(scores.submit('ace', { score: 5000 }), false);
    scores.save({ score: 3000 });
    scores.submit('bob', { score: 3000 });
    assert.deepEqual(
        scores.rows.slice(0, 2).map((row) => row.name),
        ['ACE', 'BOB'],
    );
    assert.equal(scores.bestScore, 5000);
});

function pending<T = boolean>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function musicFixture() {
    const loading = pending(),
        status = { textContent: '' };
    let starts = 0,
        eligible = true,
        mode: string | undefined;
    const audio = {
        unlock: async () => true,
        loadMusic: () => loading.promise,
        startMusic() {
            starts++;
            return true;
        },
        stopMusic() {},
        setGraphicsMode(value: string) {
            mode = value;
        },
        musicInfo: { title: 'Original' },
    };
    const music = createMusicController({
        audio: audio as unknown as Parameters<typeof createMusicController>[0]['audio'],
        status: status as unknown as HTMLElement,
        graphicsMode: 'retro',
        isEligible: () => eligible,
        isMuted: () => false,
    });
    return {
        music,
        loading,
        status,
        get starts() {
            return starts;
        },
        get mode() {
            return mode;
        },
        leave() {
            eligible = false;
        },
    };
}
test('pending title music cannot start after the application invalidates its request', async () => {
    const f = musicFixture(),
        playing = f.music.play();
    await Promise.resolve();
    f.music.invalidate();
    f.loading.resolve(true);
    await playing;
    assert.equal(f.starts, 0);
});
test('only the latest title request starts music when loading completes', async () => {
    const f = musicFixture(),
        first = f.music.play(),
        second = f.music.play();
    f.loading.resolve(true);
    await Promise.all([first, second]);
    assert.equal(f.starts, 1);
    assert.equal(f.status.textContent, 'Playing Original');
});
test('music respects current visibility and the shared Game Boy audio variant', async () => {
    const f = musicFixture(),
        playing = f.music.play();
    await Promise.resolve();
    f.leave();
    f.loading.resolve(true);
    await playing;
    assert.equal(f.starts, 0);
    f.music.setGraphicsMode('gameboy-color');
    assert.equal(f.mode, 'gameboy-color');
    f.music.setGraphicsMode('gameboy');
    assert.equal(f.mode, 'gameboy-color', 'same sound family does not restart the engine');
});
test('settings tolerate malformed saved values and canvas points account for letterboxing', () => {
    for (const value of [null, '{bad', '[]', '5', 'null']) assert.deepEqual(readObject(value), {});
    assert.deepEqual(readObject('{"retryLevel":true}'), { retryLevel: true });
    assert.equal(readGraphicsMode('bad'), 'retro');
    assert.equal(readGraphicsMode('gameboy-color'), 'gameboy-color');
    assert.deepEqual(canvasPoint({ left: 10, top: 20, width: 512, height: 500 }, 266, 270), {
        x: 128,
        y: 96,
        width: 512,
    });
    assert.equal(canvasPoint({ left: 0, top: 0, width: 0, height: 0 }, 0, 0), null);
});

// Network boundary: core resources are mandatory, platform artwork is optional.
import { loadGameResources } from '../../src/services/resources.ts';
test('core resources load without requesting optional platform artwork', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({ source: url }) };
    };
    const data = await loadGameResources(fetcher as unknown as typeof fetch);
    assert.equal((data.world as unknown as { source: string }).source, './data/world.json');
    assert.equal(
        (data.graphics as unknown as { source: string }).source,
        './assets/graphics/zx-spectrum/graphics.json',
    );
    assert.deepEqual(calls, ['./data/world.json', './assets/graphics/zx-spectrum/graphics.json']);
    assert.equal(typeof data.optional.c64, 'function');
    assert.equal(typeof data.optional.cpc, 'function');
    assert.equal(typeof data.optional['sharp-mz800'], 'function');
    assert.equal(calls.length, 2, 'reading loaders must not start optional requests');
});
test('optional platform requests share one promise during and after loading', async () => {
    const calls: string[] = [],
        c64 = pending<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetcher = async (url: string) => {
        calls.push(url);
        if (url.includes('c64')) return c64.promise;
        return { ok: true, json: async () => ({ source: url }) };
    };
    const data = await loadGameResources(fetcher as unknown as typeof fetch),
        first = data.optional.c64(),
        second = data.optional.c64();
    assert.equal(first, second);
    assert.deepEqual(calls, [
        './data/world.json',
        './assets/graphics/zx-spectrum/graphics.json',
        './assets/graphics/c64/c64-graphics.json',
    ]);
    c64.resolve({ ok: true, json: async () => ({ platform: 'c64' }) });
    assert.deepEqual(await first, { platform: 'c64' });
    assert.equal(data.optional.c64(), first);
    assert.equal(calls.length, 3);
});
test('only selected optional modes start alongside core resources and duplicates share a request', async () => {
    const calls: string[] = [],
        core = pending<{ ok: boolean; json: () => Promise<unknown> }>(),
        cpc = pending<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetcher = async (url: string) => {
        calls.push(url);
        if (url.includes('cpc')) return cpc.promise;
        if (url.includes('sharp-mz800')) return { ok: true, json: async () => ({ sharp: true }) };
        return core.promise;
    };
    const loading = loadGameResources(fetcher as unknown as typeof fetch, undefined, [
        'cpc',
        'retro',
        'sharp-mz800',
        'cpc',
        'split',
        'amiga',
        'unknown',
    ]);
    assert.deepEqual(calls.slice().sort(), [
        './assets/graphics/amstrad-cpc/cpc-graphics.json',
        './assets/graphics/sharp-mz800/graphics.json',
        './assets/graphics/zx-spectrum/graphics.json',
        './data/world.json',
    ]);
    core.resolve({ ok: true, json: async () => ({ core: true }) });
    const data = await loading,
        selected = data.optional.cpc();
    assert.equal(data.optional.cpc(), selected);
    assert.equal(calls.length, 4, 'initial loading does not wait for optional artwork');
    cpc.resolve({ ok: true, json: async () => ({ platform: 'cpc' }) });
    assert.deepEqual(await selected, { platform: 'cpc' });
    assert.deepEqual(await data.optional['sharp-mz800'](), { sharp: true });
});
test('unavailable optional artwork resolves to null and does not retry failed requests', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
        calls.push(url);
        if (url.includes('c64')) return { ok: false };
        if (url.includes('cpc')) throw new Error('offline');
        if (url.includes('sharp-mz800'))
            return {
                ok: true,
                json: async () => {
                    throw new Error('invalid artwork');
                },
            };
        return { ok: true, json: async () => ({ source: url }) };
    };
    const data = await loadGameResources(fetcher as unknown as typeof fetch);
    for (const mode of ['c64', 'cpc', 'sharp-mz800'] as const) {
        const first = data.optional[mode]();
        assert.equal(data.optional[mode](), first);
        assert.equal(await first, null);
        assert.equal(data.optional[mode](), first);
    }
    assert.equal(calls.length, 5);
});
test('core and deferred artwork requests retain the provided abort signal', async () => {
    const calls: { url: string; signal: AbortSignal | null | undefined }[] = [],
        controller = new AbortController();
    const fetcher = async (url: string, request?: RequestInit) => {
        calls.push({ url, signal: request?.signal });
        if (request?.signal?.aborted) throw new Error('aborted');
        return { ok: true, json: async () => ({ source: url }) };
    };
    const data = await loadGameResources(fetcher as unknown as typeof fetch, {
        signal: controller.signal,
    });
    await data.optional.c64();
    controller.abort();
    assert.equal(await data.optional.cpc(), null);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ signal }) => signal === controller.signal));
});
test('missing core maps report a startup failure instead of accepting an incomplete game', async () => {
    await assert.rejects(
        () => loadGameResources((async () => ({ ok: false })) as unknown as typeof fetch),
        /Could not load the game maps or graphics/,
    );
});

import { createNotifications } from '../../src/controllers/notifications.ts';
import { createGamepadNotifications } from '../../src/controllers/gamepad-notifications.ts';
import { createGamepadInput } from '../../src/input/gamepad.ts';
import { createEventScope } from '../../src/lib/events.ts';
test('gamepad event and polling share one notice, and disposal clears pending timers and listeners', () => {
    const view = new EventTarget() as EventTarget & {
            setTimeout(callback: () => void, delay: number): number;
            clearTimeout(id: number): void;
        },
        timers = new Map<number, { callback: () => void; delay: number }>();
    let next = 0;
    view.setTimeout = (callback, delay) => {
        timers.set(++next, { callback, delay });
        return next;
    };
    view.clearTimeout = (id) => timers.delete(id);
    Object.assign(view, { navigator: { getGamepads: () => [] } });
    const element = { hidden: true, textContent: '' },
        events = createEventScope(view as unknown as Window);
    const notifications = createNotifications(
        element as unknown as HTMLElement,
        view as unknown as Window,
    );
    const control = createGamepadNotifications({
        view: view as unknown as Window,
        notifications,
        events,
    });
    const pad = { index: 0, id: 'Controller', status: 'ready' };
    const connected = new Event('gamepadconnected') as Event & { gamepad: typeof pad };
    connected.gamepad = pad;
    view.dispatchEvent(connected);
    assert.equal(element.textContent, 'Gamepad connected: Controller');
    assert.equal(next, 1);
    control.update(pad as Parameters<typeof control.update>[0]);
    assert.equal(next, 1, 'polling must not refresh an already announced connection');
    assert.equal(timers.get(1)!.delay, 3500);
    control.update({ status: 'waiting', id: '', lost: true } as Parameters<
        typeof control.update
    >[0]);
    assert.equal(element.textContent, 'Gamepad disconnected: Controller');
    assert.equal(timers.size, 1);
    timers.get(next)!.callback();
    assert.equal(element.hidden, true);
    view.dispatchEvent(connected);
    assert.equal(element.hidden, false);
    notifications.destroy();
    events.destroy();
    assert.equal(timers.size, 0);
    assert.equal(element.hidden, true);
    view.dispatchEvent(connected);
    assert.equal(element.hidden, true);
});

test('missing Gamepad API stays silent for polling and connection events', () => {
    const view = Object.assign(new EventTarget(), { navigator: {} });
    const events = createEventScope(view as unknown as Window);
    const messages: string[] = [];
    const control = createGamepadNotifications({
        view: view as unknown as Window,
        notifications: { show: (message) => messages.push(message) },
        events,
    });
    const input = createGamepadInput(view.navigator);
    control.update(input.poll());
    const gamepad = { id: 'Controller', index: 0 };
    for (const type of ['gamepadconnected', 'gamepaddisconnected']) {
        view.dispatchEvent(Object.assign(new Event(type), { gamepad }));
    }
    assert.deepEqual(messages, []);
    events.destroy();
});
