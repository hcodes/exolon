import { openHome, openSettings } from './navigation.ts';
import { serveReferenceModules } from './reference-mode.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import * as music from '../../src/audio/compressed/recordings.ts';
import { readFile } from 'node:fs/promises';

interface MusicSource {
    context: BaseAudioContext;
    duration: number;
    channels: number;
    sampleRate: number;
    loopStart: number;
    loopEnd: number;
}
declare global {
    interface Window {
        __compressedMusicSources: MusicSource[];
        __compressedMusicDecodes: number;
    }
}
const ORIGIN = 'http://127.0.0.1:8091';

async function setup(page: Page) {
    page.setDefaultTimeout(30000);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    // A real URL prefix exercises resolution in bundled modern and ES5 builds.
    await page.route(`${ORIGIN}/reex/**`, async (route) => {
        const url = route.request().url().replace(`${ORIGIN}/reex/`, `${ORIGIN}/`);
        await route.fulfill({ response: await route.fetch({ url }) });
    });
    await page.addInitScript(() => {
        window.__compressedMusicSources = [];
        window.__compressedMusicDecodes = 0;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const decode = Audio.prototype.decodeAudioData;
        Audio.prototype.decodeAudioData = function (bytes, resolve, reject) {
            window.__compressedMusicDecodes++;
            let settled = false;
            const done = () => {
                if (!settled) {
                    settled = true;
                    window.__compressedMusicDecodes--;
                }
            };
            try {
                const pending = decode.call(
                    this,
                    bytes,
                    (buffer) => {
                        done();
                        resolve?.(buffer);
                    },
                    (error) => {
                        done();
                        reject?.(error);
                    },
                );
                void pending?.then(done, done);
                return pending;
            } catch (error) {
                done();
                throw error;
            }
        };
        const create = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const source = create.apply(this, args);
            const start = source.start;
            source.start = function (...values) {
                if (source.loop && source.buffer && source.buffer.duration > 5)
                    window.__compressedMusicSources.push({
                        context: source.context,
                        duration: source.buffer.duration,
                        channels: source.buffer.numberOfChannels,
                        sampleRate: source.buffer.sampleRate,
                        loopStart: source.loopStart,
                        loopEnd: source.loopEnd,
                    });
                return start.apply(this, values);
            };
            return source;
        };
    });
}
async function choose(page: Page, platform: string) {
    const banner = page.locator(`[data-platform="${platform}"][aria-disabled="false"]`);
    await banner.waitFor();
    await banner.focus();
    await page.keyboard.press('Enter');
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
}

async function checkRealDecoding(browser: Browser, name: string) {
    const page = await browser.newPage();
    await serveReferenceModules(page);
    try {
        await page.goto(`${ORIGIN}/`);
        for (const metadata of Object.values(music)) {
            const file = metadata.file;
            const originalBase64 = (
                await readFile(
                    new URL(
                        '../../originals/audio/' + file.replace(/\.m4a$/, '.wav'),
                        import.meta.url,
                    ),
                )
            ).toString('base64');
            const result = await page.evaluate(
                async ({ file, metadata, originalBase64 }) => {
                    const Audio = window.AudioContext || window.webkitAudioContext;
                    if (!Audio) throw new Error('Web Audio unavailable');
                    const context = new Audio();
                    try {
                        const decodeBytes = (bytes: ArrayBuffer) =>
                            new Promise<AudioBuffer>((resolve, reject) => {
                                const pending = context.decodeAudioData(bytes, resolve, reject);
                                pending?.then?.(resolve, reject);
                            });
                        const response = await fetch('./audio/' + file);
                        if (!response.ok) throw new Error('Missing actual music: ' + file);
                        const original = await decodeBytes(
                            Uint8Array.from(atob(originalBase64), (char) => char.charCodeAt(0))
                                .buffer,
                        );
                        const compressed = await decodeBytes(await response.arrayBuffer());
                        const reference = original.getChannelData(0);
                        const helperUrl = new URL('./audio/recordings.js', location.href).href;
                        const helper = (await import(helperUrl)) as {
                            loadRecording(options: {
                                url: URL;
                                context: AudioContext;
                                timing: typeof metadata;
                                fetcher: typeof fetch;
                            }): Promise<AudioBuffer>;
                        };
                        const helperRequests: string[] = [];
                        const normalized = await helper.loadRecording({
                            url: new URL(`./audio/${file}`, location.href),
                            timing: metadata,
                            context,
                            fetcher: (input, init) => {
                                helperRequests.push(String(input));
                                return fetch(input, init);
                            },
                        });
                        const candidate = normalized.getChannelData(0);
                        const rawCandidate = compressed.getChannelData(0);
                        const windowLength = 4096;
                        // Pick the loudest complete early window so an introductory silence
                        // cannot disguise encoder priming. Both buffers use the context rate.
                        let offset = 4096;
                        let energy = -1;
                        for (
                            let start = 4096;
                            start + windowLength <
                            Math.min(reference.length, context.sampleRate * 8);
                            start += windowLength
                        ) {
                            let sum = 0;
                            for (let i = 0; i < windowLength; i += 8)
                                sum += reference[start + i] ** 2;
                            if (sum > energy) {
                                energy = sum;
                                offset = start;
                            }
                        }
                        function correlation(lag: number, samples = candidate) {
                            let xy = 0,
                                xx = 0,
                                yy = 0;
                            for (let i = 0; i < windowLength; i += 8) {
                                const x = reference[offset + i],
                                    y = samples[offset + i + lag];
                                xy += x * y;
                                xx += x * x;
                                yy += y * y;
                            }
                            return xy / Math.sqrt(xx * yy);
                        }
                        let bestLag = 0;
                        let best = correlation(0, rawCandidate);
                        let normalizedBest = correlation(0);
                        let normalizedLag = 0;
                        const searchFrames = Math.ceil(
                            (3072 * context.sampleRate) / metadata.sampleRate,
                        );
                        for (let lag = -searchFrames; lag <= searchFrames; lag++) {
                            const alignedValue = correlation(lag);
                            if (alignedValue > normalizedBest) {
                                normalizedBest = alignedValue;
                                normalizedLag = lag;
                            }
                            const value = correlation(lag, rawCandidate);
                            if (value > best) {
                                best = value;
                                bestLag = lag;
                            }
                        }
                        return {
                            helperRequests,
                            originalFrames: original.length,
                            compressedFrames: compressed.length,
                            normalizedFrames: normalized.length,
                            normalizedChannels: normalized.numberOfChannels,
                            sampleRate: context.sampleRate,
                            originalChannels: original.numberOfChannels,
                            compressedChannels: compressed.numberOfChannels,
                            rawCorrelation: correlation(0, rawCandidate),
                            correlation: correlation(0),
                            bestCorrelation: best,
                            bestLag,
                            normalizedLag,
                        };
                    } finally {
                        await context.close();
                    }
                },
                { file, metadata, originalBase64 },
            );
            const label = `${name} ${file}: ${JSON.stringify(result)}`;
            assert.deepEqual(
                result.helperRequests.map((url) => new URL(url).pathname),
                [`/audio/${metadata.file}`],
                label,
            );
            assert.match(
                new URL(result.helperRequests[0]).searchParams.get('v')!,
                /^[a-f0-9]{16}$/,
                label,
            );
            assert.equal(result.originalChannels, metadata.channels, label);
            assert.equal(result.compressedChannels, metadata.channels, label);
            assert.equal(result.normalizedChannels, metadata.channels, label);
            assert.ok(Math.abs(result.normalizedFrames - result.originalFrames) <= 1, label);
            assert.ok(
                Math.abs(
                    result.originalFrames -
                        (metadata.frames * result.sampleRate) / metadata.sampleRate,
                ) <= 1,
                label,
            );
            assert.ok(
                Math.abs(result.compressedFrames - result.originalFrames) <=
                    Math.ceil((4096 * result.sampleRate) / metadata.sampleRate),
                `AAC end padding stays within four codec frames: ${label}`,
            );
            assert.ok(result.correlation > 0.8, `AAC retains audible PCM alignment: ${label}`);
            assert.ok(
                Math.abs(result.normalizedLag) <= 4,
                `Normalized AAC introduces no priming shift: ${label}`,
            );
            assert.ok(
                result.bestCorrelation > 0.8,
                `Raw AAC preserves source pitch and alignment: ${label}`,
            );
            console.log(`PASS: ${label}`);
        }
    } finally {
        await page.close();
    }
}

async function checkTransport(browser: Browser, name: string) {
    for (const legacy of [false, true])
        for (const [platform, directory] of [
            ['c64', 'c64'],
            ['amiga', 'amiga'],
            ['atari-st', 'atari-st'],
        ] as const)
            for (const failure of ['none', '404', 'decode'] as const) {
                const page = await browser.newPage();
                const requests: string[] = [],
                    errors: string[] = [];
                page.on('request', (request) => requests.push(new URL(request.url()).pathname));
                page.on('pageerror', (error) => errors.push(error.message));
                await setup(page);
                if (failure !== 'none')
                    await page.route(`**/audio/${directory}/title.m4a*`, (route) =>
                        route.fulfill(
                            failure === '404'
                                ? { status: 404, body: '' }
                                : { contentType: 'audio/mp4', body: 'corrupt AAC music' },
                        ),
                    );
                try {
                    await page.goto(`${ORIGIN}/reex/${legacy ? '?legacy=1' : ''}`);
                    assert.equal(
                        requests.some((path) => /\/audio\//.test(path)),
                        false,
                        'Picker keeps recordings demand loaded',
                    );
                    const titleResponse = page.waitForResponse(`**/audio/${directory}/title.m4a*`);
                    await choose(page, platform);
                    await (await titleResponse).finished();
                    if (failure === 'none') {
                        await page.waitForFunction(
                            () => window.__compressedMusicSources.length > 0,
                        );
                        const recording = Object.values(music).find(
                            (data) => data.file === `${directory}/title.m4a`,
                        )!;
                        const source = await page.evaluate(() => {
                            const { context, ...details } = window.__compressedMusicSources[0];
                            return { ...details, state: context.state };
                        });
                        assert.equal(source.channels, recording.channels);
                        assert.equal(source.state, 'running');
                        assert.ok(
                            Math.abs(source.duration - recording.frames / recording.sampleRate) <=
                                1 / source.sampleRate,
                        );
                        if (platform === 'atari-st') {
                            assert.equal(source.loopStart, 876 / 44100);
                            assert.equal(source.loopEnd, 9106234 / 44100);
                        }
                    } else {
                        await page.waitForFunction(() => window.__compressedMusicDecodes === 0);
                        await page.evaluate(
                            () =>
                                new Promise((resolve) =>
                                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                ),
                        );
                        assert.equal(
                            await page.evaluate(() => window.__compressedMusicSources.length),
                            0,
                        );
                    }
                    const requestedMusic = requests.filter((path) =>
                        path.includes(`/audio/${directory}/title.`),
                    );
                    assert.deepEqual(requestedMusic, [`/reex/audio/${directory}/title.m4a`]);
                    assert.ok(
                        !requests.some(
                            (path) =>
                                path.includes('/originals/') ||
                                /\/(?:title|game-over)\.wav$/.test(path),
                        ),
                        'No archived source recording may be requested',
                    );
                    if (failure !== 'none') {
                        await openHome(page);
                        await page.locator('#new-game').focus();
                        await page.keyboard.press('Enter');
                        await page.locator('#new-game').waitFor({ state: 'hidden' });
                        await page.waitForFunction(() => window.__compressedMusicDecodes === 0);
                    }
                    if (platform === 'c64')
                        assert.ok(
                            requests.some((path) => path.endsWith('/c64/shot.wav')),
                            'Short effects retain their WAV transport',
                        );
                    assert.deepEqual(errors, []);
                } finally {
                    await page.close();
                }
            }
    console.log(
        `PASS: ${name} direct M4A music, recoverable 404/corrupt AAC without archived requests and exact loops under /reex/ in modern/legacy bundles.`,
    );
}

async function checkCancelledTransport(browser: Browser, name: string) {
    for (const legacy of [false, true])
        for (const platform of ['c64', 'amiga', 'atari-st']) {
            const page = await browser.newPage();
            const requests: string[] = [],
                errors: string[] = [];
            page.on('request', (request) => requests.push(new URL(request.url()).pathname));
            page.on('pageerror', (error) => errors.push(error.message));
            await setup(page);
            // Simulate old browsers where a request cannot be physically aborted.
            await page.addInitScript(() =>
                Object.defineProperty(window, 'AbortController', {
                    configurable: true,
                    value: undefined,
                }),
            );
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            await page.route(`**/audio/${platform}/title.m4a*`, async (route) => {
                await gate;
                await route.fulfill({ status: 404, body: '' });
            });
            try {
                await page.goto(`${ORIGIN}/reex/${legacy ? '?legacy=1' : ''}`);
                const pending = page.waitForRequest(`**/audio/${platform}/title.m4a*`);
                await choose(page, platform);
                await pending;
                if (await page.locator('#settings-toggle[aria-expanded="false"]').count())
                    await page.locator('#settings-toggle').click();
                const next = platform === 'amiga' ? 'atari-st' : 'amiga';
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption(next);
                await page
                    .locator(`[data-game="${next}"] #new-game:not([disabled])`)
                    .waitFor({ state: 'attached' });
                await page.waitForFunction(() => window.__compressedMusicSources.length > 0);
                const response = page.waitForResponse(`**/audio/${platform}/title.m4a*`);
                release();
                await (await response).finished();
                await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
                assert.equal(
                    requests.some((path) => path.endsWith(`/audio/${platform}/title.wav`)),
                    false,
                    'Disposed music cannot request archived WAV after a late AAC error',
                );
                assert.equal(
                    await page.evaluate(() =>
                        window.__compressedMusicSources.some(
                            (source) => source.context.state === 'closed',
                        ),
                    ),
                    false,
                    'Disposed music cannot start playback',
                );
                assert.deepEqual(errors, []);
            } finally {
                release();
                await page.close();
            }
        }
    console.log(
        `PASS: ${name} cancelled modern/legacy classic/native music never requests archives or plays after disposal.`,
    );
}

export async function checkCompressedMusic(browser: Browser, name: string) {
    await checkRealDecoding(browser, name);
    await checkTransport(browser, name);
    await checkCancelledTransport(browser, name);
}
