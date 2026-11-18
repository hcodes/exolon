import { activateControl, menuPresented } from './control-navigation.ts';
import { prepareControl } from './control-navigation.ts';
import { checkSeo } from './seo.ts';
import { checkGameLayout } from './game-layout.ts';
import { checkDeviceDetection } from './device-detection.ts';
import { MOBILE_USER_AGENT } from './devices.ts';
import { checkVr } from './vr.ts';
import { checkVrImmersive } from './vr-immersive.ts';
import { checkVrPanels } from './vr-panels.ts';
import { checkVrSupport } from './vr-support.ts';
import { checkRocketTrail } from './rocket-trail.ts';
import { checkRocketCommand } from './rocket-command.ts';
import { checkNativePacing } from './native-pacing.ts';
import { checkControlMenu } from './control-menu.ts';
import { checkOriginalCheats, checkZxGameOver } from './original-cheats.ts';
import { checkGamepadHint } from './gamepad-hint.ts';
import { checkAnalytics } from './analytics.ts';
import { checkMotionTiming } from './motion-timing.ts';
import { SIMULATION_INTERVAL } from '../../src/constants/game.ts';
import { checkUiControls } from './ui-controls.ts';
import {
    enterGame,
    openGame,
    reloadGame,
    openSettings,
    closeSettings,
    openHome,
    closeHome,
} from './navigation.ts';
import type { GraphicTile, Bytes } from '../../src/types/graphics.ts';
import type { HighScoreRow } from '../../src/model/high-scores.ts';
import type { Browser, Page, CDPSession, Route } from 'playwright';
import type { AudioDetails, AudioRecord, AudioSnapshot } from './types.ts';
import type { Cheats } from '../../src/types/game.ts';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { checkRemasteredMachinery } from './remastered-machinery.ts';
import { checkRemasteredCache } from './remastered-cache.ts';
import { checkSplitRenderer, checkSplitControl } from './split.ts';
import { checkC64 } from './c64.ts';
import { checkCPC } from './cpc.ts';
import { checkSharp } from './sharp.ts';
import { checkAtariSt } from './atari-st.ts';
import { checkAmiga } from './amiga.ts';
import { checkGameBoy } from './gameboy.ts';
import { checkStartMenu } from './start-menu.ts';
import { checkSplitPairsRenderer } from './split-pairs-renderer.ts';
import { checkSplitPairUI } from './split-pairs-ui.ts';
import { checkIntro } from './intro.ts';
import { checkAirborneWeapons } from './airborne.ts';
import { checkPlatformPicker } from './platform-picker.ts';
import { checkHome } from './home.ts';
import { checkPlatformSelection } from './platform-select.ts';
import { checkLoading } from './loading.ts';
import { checkCompressedMusic } from './compressed-music.ts';
import { useReferenceRuntime } from './reference-mode.ts';
import { checkSettingsPanel } from './settings-panel.ts';
import { checkActivityPause } from './activity-pause.ts';
import { checkPauseResume } from './pause-resume.ts';
import { checkLaunchOptions } from './launch-options.ts';
import { checkTv, checkWebOs3Startup } from './tv.ts';
import { checkPs4 } from './ps4.ts';
import { checkMobile } from './mobile.ts';
import { checkTitleTap } from './title-tap.ts';
import { checkLegacy } from './legacy.ts';
import { checkPreact, checkPreactBonus } from './preact.ts';

const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
});
const DEFAULT_TITLE = 'title-128k.mp3';
const GUSLI_TITLE = 'title-gusli-lead.m4a';
const SYNTHWAVE_TITLE = 'title-synthwave.m4a';
const AMBIENT_TITLE = 'title-ambient.m4a';
const ROCK_TITLE = 'title-space-rock.m4a';
const GUITAR_TITLE = 'title-guitar-lead.m4a';
const ORGAN_TITLE = 'title-organ-lead.m4a';
const VIOLIN_TITLE = 'title-violin-lead.m4a';
const PREVIOUS_TITLE = 'title-orchestral-strings.m4a';
const FIRST_ORCHESTRAL_TITLE = 'title-orchestral.m4a';
const ORIGINAL_TITLE = 'title-128k.mp3';
const TITLE_FILES = [
    GUSLI_TITLE,
    VIOLIN_TITLE,
    PREVIOUS_TITLE,
    FIRST_ORCHESTRAL_TITLE,
    ORIGINAL_TITLE,
];
const ALL_TITLE_FILES = [
    ROCK_TITLE,
    AMBIENT_TITLE,
    SYNTHWAVE_TITLE,
    ORGAN_TITLE,
    GUITAR_TITLE,
    ...TITLE_FILES,
];
const errors: string[] = [];
let activePage: Page | undefined;
async function prepare(page: Page) {
    await useReferenceRuntime(page);
    // Browser verification must not send synthetic visits to the live counter.
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        // General control scenarios use an expanded preference; dedicated
        // settings and picker scenarios verify the fresh-install default.
        localStorage.setItem('exolon-settings-collapsed', 'false');
        window.__exolonAudio = [];
        window.__exolonAudioContexts = [];
        window.__exolonAudioGains = [];
        window.__exolonAudioDecodes = [];
        window.__exolonResumeWaiters = [];
        window.__exolonAudioSnapshot = () => {
            const loops = window.__exolonAudio.filter(
                (source) => source.started && source.loop && source.duration > 5,
            );
            const active = loops.filter((source) => !source.stopped && !source.ended);
            return {
                loops: loops.length,
                active: active.length,
                audible: active.filter((source) => {
                    const context = window.__exolonAudioContexts[source.context];
                    return (
                        context.state === 'running' &&
                        context.currentTime > source.startedAt + 0.03 &&
                        source.peak > 0.01 &&
                        window.__exolonAudioGains.some(
                            (gain) => gain.context === context && gain.gain.value > 0,
                        )
                    );
                }).length,
                effects: window.__exolonAudio.filter(
                    (source) => source.started && !source.loop && source.peak > 0.01,
                ).length,
                states: window.__exolonAudioContexts.map((context) => context.state),
                gain: window.__exolonAudioGains[0]?.gain.value ?? null,
                decoded: window.__exolonAudioDecodes.some((record) => record.done && record.ok),
                waitingResumes: window.__exolonResumeWaiters.length,
                activated: navigator.userActivation?.hasBeenActive ?? false,
                musicButton: Boolean(document.getElementById('music') as HTMLElement),
                status: (document.getElementById('music-status') as HTMLElement)
                    ?.textContent as string,
                title: !(document.getElementById('title-screen') as HTMLElement)?.hidden,
                track: active[0]
                    ? {
                          duration: active[0].duration,
                          channels: active[0].channels!,
                          sampleRate: active[0].sampleRate!,
                          peak: active[0].peak,
                          rms: active[0].rms!,
                          stereoDifference: active[0].stereoDifference!,
                      }
                    : null,
            };
        };
        window.__exolonReleaseResume = () => {
            window.__exolonHoldResume = false;
            for (const resume of window.__exolonResumeWaiters.splice(0)) resume();
        };
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const remember = (context: BaseAudioContext) => {
            if (!window.__exolonAudioContexts.includes(context as AudioContext))
                window.__exolonAudioContexts.push(context as AudioContext);
            return window.__exolonAudioContexts.indexOf(context as AudioContext);
        };
        const resume = Audio.prototype.resume;
        Audio.prototype.resume = function (...args) {
            remember(this);
            if (window.__exolonHoldResume) {
                return new Promise((resolve, reject) =>
                    window.__exolonResumeWaiters.push(() =>
                        resume.apply(this, args).then(resolve, reject),
                    ),
                );
            }
            return resume.apply(this, args);
        };
        const createGain = Audio.prototype.createGain;
        Audio.prototype.createGain = function (...args) {
            remember(this);
            const gain = createGain.apply(this, args);
            window.__exolonAudioGains.push(gain);
            return gain;
        };
        const decode = Audio.prototype.decodeAudioData;
        Audio.prototype.decodeAudioData = function (...args) {
            const record = { done: false, ok: false };
            window.__exolonAudioDecodes.push(record);
            if (typeof args[1] === 'function' || typeof args[2] === 'function') {
                const success = args[1],
                    failure = args[2];
                args[1] = (buffer) => {
                    record.done = true;
                    record.ok = true;
                    success?.(buffer);
                };
                args[2] = (error) => {
                    record.done = true;
                    failure?.(error);
                };
                // Preserve the native returned Promise so an unhandled decoder
                // rejection in production is not hidden by test observation.
                return decode.apply(this, args);
            }
            const result = decode.apply(this, args);
            return result?.then
                ? result.then(
                      (buffer) => {
                          record.done = true;
                          record.ok = true;
                          return buffer;
                      },
                      (error) => {
                          record.done = true;
                          throw error;
                      },
                  )
                : result;
        };
        const bufferDetails = new WeakMap<AudioBuffer, AudioDetails>();
        const original = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const source = original.apply(this, args);
            const context = source.context;
            const record: AudioRecord = {
                started: false,
                stopped: false,
                ended: false,
                loop: false,
                duration: 0,
                peak: 0,
                context: remember(context),
                startedAt: 0,
            };
            window.__exolonAudio.push(record);
            source.addEventListener('ended', () => {
                record.ended = true;
            });
            const start = source.start;
            const stop = source.stop;
            source.start = function (...values) {
                const result = start.apply(this, values);
                record.started = true;
                record.loop = this.loop;
                record.duration = this.buffer?.duration || 0;
                record.startedAt = context.currentTime;
                if (this.buffer) {
                    let details = bufferDetails.get(this.buffer);
                    if (!details) {
                        const left = this.buffer.getChannelData(0),
                            right = this.buffer.getChannelData(
                                Math.min(1, this.buffer.numberOfChannels - 1),
                            );
                        let peak = 0,
                            leftPower = 0,
                            rightPower = 0,
                            difference = 0;
                        for (let index = 0; index < left.length; index++) {
                            peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
                            leftPower += left[index] ** 2;
                            rightPower += right[index] ** 2;
                            difference += (left[index] - right[index]) ** 2;
                        }
                        details = {
                            peak,
                            channels: this.buffer.numberOfChannels,
                            sampleRate: this.buffer.sampleRate,
                            rms: [
                                Math.sqrt(leftPower / left.length),
                                Math.sqrt(rightPower / right.length),
                            ],
                            stereoDifference: Math.sqrt(difference / left.length),
                        };
                        bufferDetails.set(this.buffer, details);
                    }
                    Object.assign(record, details);
                }
                return result;
            };
            source.stop = function (...values) {
                record.stopped = true;
                return stop.apply(this, values);
            };
            return source;
        };
    });
}
async function begin(page: Page, path = '') {
    const response = await openGame(page, `http://127.0.0.1:8091/${path}`);
    assert.equal(response!.status(), 200);
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
    assert.equal(await menuPresented(page, 'title-screen'), true);
    await openHome(page);
    await page.locator('#new-game').click();
    await page.waitForFunction(
        () =>
            (document.getElementById('title-screen') as HTMLElement).hidden &&
            (document.getElementById('overlay') as HTMLElement).hidden,
    );
    await waitForPlaying(page);
}
async function overlayOpen(page: Page) {
    return page.locator('#overlay').evaluate((element: HTMLElement) => !element.hidden);
}
async function waitForPlaying(page: Page) {
    await page.waitForFunction(() =>
        /^(STAGE|MISSION \/ AUDIO)/.test(
            (document.getElementById('mission-status') as HTMLElement).textContent!,
        ),
    );
}
async function fireUntil(page: Page, field: string, value: string) {
    await page.keyboard.down('Space');
    try {
        await page.waitForFunction(
            ({ field, value }) =>
                (document.getElementById(field) as HTMLElement).textContent! === value,
            { field, value },
        );
    } finally {
        await page.keyboard.up('Space');
    }
}
async function expectMusic(page: Page, label: string, kind = 'original') {
    const recordingLabel =
        kind === 'synthwave'
            ? 'Synthwave'
            : kind === 'ambient'
              ? 'Ambient'
              : kind === 'space-rock'
                ? 'Space rock'
                : kind === 'organ-lead'
                  ? 'Organ'
                  : kind === 'guitar-lead'
                    ? 'Acoustic guitar'
                    : kind === 'gusli-lead'
                      ? 'Gusli'
                      : kind === 'violin-lead'
                        ? 'Solo violin'
                        : kind === 'strings-winds'
                          ? 'Violin and winds'
                          : kind === 'orchestral'
                            ? 'First orchestral version'
                            : 'Original';
    await page.waitForFunction(
        (recordingLabel) => {
            const snapshot = window.__exolonAudioSnapshot();
            return snapshot.audible === 1 && snapshot.status.includes(recordingLabel);
        },
        recordingLabel,
        { timeout: 30000 },
    );
    const snapshot = await page.evaluate(() => window.__exolonAudioSnapshot());
    assert.equal(
        snapshot.active,
        1,
        `${label}: one non-silent PCM loop must run on a native advancing AudioContext`,
    );
    assert.equal(snapshot.musicButton, false, `${label}: music must not require a separate button`);
    assert.ok(
        snapshot.status.includes(recordingLabel),
        `${label}: the status must identify the recording actually playing`,
    );
    assert.equal(snapshot.track!.channels, 2, `${label}: the decoded recording must retain stereo`);
    if (kind !== 'original') {
        const duration =
            kind === 'ambient'
                ? [112, 115]
                : [
                        'gusli-lead',
                        'violin-lead',
                        'strings-winds',
                        'guitar-lead',
                        'organ-lead',
                        'synthwave',
                        'space-rock',
                    ].includes(kind)
                  ? [110, 113]
                  : [73.5, 75.5];
        assert.ok(
            snapshot.track!.duration > duration[0] && snapshot.track!.duration < duration[1],
            `${label}: the native arrangement decode must retain its complete score and release tail`,
        );
        assert.ok(
            snapshot.track!.peak > 0.05 &&
                snapshot.track!.peak < 1 &&
                snapshot.track!.rms.every((value) => value > 0.01),
            `${label}: decoded orchestral PCM must be non-silent and retain peak headroom`,
        );
        assert.ok(
            snapshot.track!.stereoDifference > 0.0001,
            `${label}: the orchestral recording must contain two distinct stereo channels`,
        );
    } else
        assert.ok(
            snapshot.track!.duration > 72.5 && snapshot.track!.duration < 73.5,
            `${label}: fallback must use the preserved original recording`,
        );
    return snapshot;
}
function titleRequests(page: Page) {
    const requests: string[] = [];
    page.on('request', (request) => {
        const filename = new URL(request.url()).pathname.split('/').at(-1);
        if (ALL_TITLE_FILES.includes(filename!)) requests.push(filename!);
    });
    return requests;
}
async function cdpValue<T = AudioSnapshot>(client: CDPSession, expression: string): Promise<T> {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: false,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value as T;
}
async function cdpAudioUntil(client: CDPSession, predicate: string) {
    const snapshot = await cdpValue(
        client,
        `(async () => {
        const started = performance.now();
        while (!(${predicate})) {
            if (performance.now() - started > 30000) return {...window.__exolonAudioSnapshot(), timedOut: true};
            await new Promise(requestAnimationFrame);
        }
        return window.__exolonAudioSnapshot();
    })()`,
    );
    assert.ok(
        !snapshot.timedOut,
        `Native audio condition did not settle: ${JSON.stringify(snapshot)}`,
    );
    return snapshot;
}
async function setTestVisibility(page: Page, hidden: boolean) {
    await page.evaluate((value) => {
        window.__exolonHidden = value;
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => window.__exolonHidden,
        });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => (window.__exolonHidden ? 'hidden' : 'visible'),
        });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}
async function checkTitleMusic(session: Browser, name: string, { permissive = false } = {}) {
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 } });
    await prepare(page);
    const requests = titleRequests(page);
    try {
        const client = permissive ? await page.context().newCDPSession(page) : null;
        await page.goto('http://127.0.0.1:8091/', { waitUntil: 'domcontentloaded' });
        if (permissive) {
            const first = await cdpAudioUntil(
                client!,
                "document.querySelector('[data-platform=retro][aria-disabled=false]') !== null",
            );
            assert.equal(first.activated, false, 'Picker is checked before any user gesture');
            assert.equal(first.musicButton, false);
            assert.equal(
                first.active,
                0,
                'Platform chooser stays silent even when autoplay is permitted',
            );
        }
        await enterGame(page);
        await page.locator('#game').click();
        const first = await expectMusic(page, name);
        await page.waitForFunction(
            () =>
                (document.getElementById('game') as HTMLCanvasElement).dataset.intro === undefined,
        );
        assert.deepEqual(
            requests,
            [DEFAULT_TITLE],
            `${name}: Retro must fetch only the original recording`,
        );
        await page.locator('#game').click();
        await page.keyboard.press('x');
        const repeated = await expectMusic(page, name);
        assert.equal(
            repeated.loops,
            first.loops,
            `${name}: repeated title gestures must not duplicate the loop`,
        );
        await page.locator('#sound').click();
        await page.waitForFunction(
            () =>
                window.__exolonAudioSnapshot().gain === 0 &&
                window.__exolonAudioSnapshot().active === 0,
        );
        await page.locator('#game').click();
        await page.keyboard.press('x');
        assert.equal(
            (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
            0,
            `${name}: gestures must not defeat mute`,
        );
        await page.locator('#sound').click();
        await expectMusic(page, name);
        await page.locator('#volume').evaluate((control: HTMLInputElement) => {
            control.value = '0';
            control.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).gain, 0);
        await page.locator('#volume').evaluate((control: HTMLInputElement) => {
            control.value = '.35';
            control.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expectMusic(page, name);
        // Headless tabs stay visible. This visibility fixture changes only the
        // DOM signal; playback still uses the unmodified native audio graph.
        await setTestVisibility(page, true);
        await page.waitForFunction(() => window.__exolonAudioSnapshot().active === 0);
        const hidden = await page.evaluate(() => window.__exolonAudioSnapshot());
        await setTestVisibility(page, true);
        await setTestVisibility(page, false);
        await expectMusic(page, name);
        await setTestVisibility(page, false);
        const visible = await expectMusic(page, name);
        assert.equal(
            visible.loops,
            hidden.loops + 1,
            `${name}: repeated visibility events must restart only one loop`,
        );
        if (permissive) {
            // A cached recording can be ready before an allowed native resume settles.
            // Defer the actual resume, then release it without another gesture.
            await setTestVisibility(page, true);
            await page.evaluate(async () => {
                await window.__exolonAudioContexts[0].suspend();
                window.__exolonHoldResume = true;
            });
            await setTestVisibility(page, false);
            await page.waitForFunction(() => {
                const state = window.__exolonAudioSnapshot();
                return (
                    state.waitingResumes > 0 &&
                    state.states.includes('suspended') &&
                    state.status.includes('after a tap')
                );
            });
            await page.evaluate(() => window.__exolonReleaseResume());
            await expectMusic(page, `${name} cached-buffer/native-resume race`);
            // A trusted gameplay unlock may also remain pending. The model must
            // continue immediately, and its eventual completion cannot play title music.
            await page.evaluate(async () => {
                await window.__exolonAudioContexts[0].suspend();
                window.__exolonHoldResume = true;
            });
        }
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await fireUntil(page, 'ammo', '98');
        assert.equal(
            (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
            0,
            `${name}: game start must stop title music`,
        );
        if (permissive) {
            const pending = await page.evaluate(() => window.__exolonAudioSnapshot());
            assert.ok(
                pending.waitingResumes > 0 && pending.states.includes('suspended'),
                'The game must advance while its real native resume remains pending',
            );
            await page.evaluate(() => window.__exolonReleaseResume());
            await page.waitForFunction(() =>
                window.__exolonAudioSnapshot().states.includes('running'),
            );
            // Let one complete model tick observe Space released before the next tap;
            // a fast native resume can otherwise complete within the same tick.
            await page.evaluate(
                (interval) =>
                    new Promise<void>((resolve) => {
                        const started = performance.now();
                        function released(now: number) {
                            if (now - started >= interval) resolve();
                            else requestAnimationFrame(released);
                        }
                        requestAnimationFrame(released);
                    }),
                SIMULATION_INTERVAL + 1000 / 60,
            );
            await fireUntil(page, 'ammo', '97');
            assert.equal(
                (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
                0,
                'Late gameplay unlock must not start title music',
            );
        }
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await expectMusic(page, `${name} menu return`);
        assert.deepEqual(
            requests,
            [DEFAULT_TITLE],
            `${name}: menu lifecycle must reuse its decoded original recording`,
        );
        console.log(
            `PASS: ${name} original native title PCM ${JSON.stringify(first.track)}; alternative arrangements are not fetched.`,
        );
        console.log(
            `PASS: ${name} native title music, generic gestures, mute/volume, visibility and menu idempotence${permissive ? ', silent platform picker and delayed-native-resume races' : ''}.`,
        );
    } finally {
        await page.close();
    }
}
async function checkStrictAutoplay() {
    const session = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=document-user-activation-required'],
    });
    try {
        for (const firstAction of ['pointer', 'key', 'game']) {
            const page = await session.newPage({ viewport: { width: 1100, height: 1000 } });
            await prepare(page);
            const client = await page.context().newCDPSession(page);
            try {
                await page.goto('http://127.0.0.1:8091/', { waitUntil: 'domcontentloaded' });
                const blocked = await cdpAudioUntil(
                    client,
                    "document.querySelector('[data-platform=retro][aria-disabled=false]') !== null",
                );
                assert.equal(
                    blocked.activated,
                    false,
                    'Strict policy is tested without Playwright activation',
                );
                assert.deepEqual(
                    blocked.states,
                    [],
                    'Audio is not initialized before platform choice',
                );
                assert.equal(blocked.loops, 0);
                if (firstAction === 'key') {
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyDown',
                        key: 'Enter',
                        code: 'Enter',
                        windowsVirtualKeyCode: 13,
                    });
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyUp',
                        key: 'Enter',
                        code: 'Enter',
                        windowsVirtualKeyCode: 13,
                    });
                } else {
                    const point = await cdpValue<{ x: number; y: number }>(
                        client,
                        "(() => {const r=document.querySelector('[data-platform=retro]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
                    );
                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mousePressed',
                        ...point,
                        button: 'left',
                        clickCount: 1,
                    });
                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseReleased',
                        ...point,
                        button: 'left',
                        clickCount: 1,
                    });
                }
                const playing = await cdpAudioUntil(
                    client,
                    'window.__exolonAudioSnapshot().audible === 1',
                );
                assert.equal(playing.active, 1);
                assert.equal(playing.activated, true);
                assert.equal(playing.loops, 1, 'One banner gesture starts exactly one music loop');
                if (firstAction === 'game') {
                    await openHome(page);
                    await page.locator('#new-game').press('Enter');
                    await waitForPlaying(page);
                    await fireUntil(page, 'ammo', '98');
                    const snapshot = await cdpValue(client, 'window.__exolonAudioSnapshot()');
                    assert.equal(snapshot.active, 0, 'Starting gameplay stops title music');
                    assert.equal(
                        snapshot.loops,
                        1,
                        'Starting gameplay cannot produce another title loop',
                    );
                } else {
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyDown',
                        key: 'x',
                        code: 'KeyX',
                        windowsVirtualKeyCode: 88,
                    });
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyUp',
                        key: 'x',
                        code: 'KeyX',
                        windowsVirtualKeyCode: 88,
                    });
                    const repeated = await cdpAudioUntil(
                        client,
                        'window.__exolonAudioSnapshot().audible === 1',
                    );
                    assert.equal(
                        repeated.loops,
                        1,
                        'Following gestures do not duplicate banner music',
                    );
                }
            } finally {
                await page.close();
            }
        }
        console.log(
            'PASS: strict native Chromium stays silent on picker; one banner gesture starts music; gameplay stops it without duplicate loops.',
        );
    } finally {
        await session.close();
    }
}
async function checkPendingMusic(session: Browser) {
    const page = await session.newPage();
    await prepare(page);
    let blocked!: (route: Route) => void;
    const intercepted = new Promise<Route>((resolve) => {
        blocked = resolve;
    });
    await page.route(`**/${DEFAULT_TITLE}*`, (route) => blocked(route));
    const requested = page.waitForRequest(`**/${DEFAULT_TITLE}*`);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.locator('#game').click();
        await requested;
        const recording = await intercepted;
        await openHome(page);
        await page.locator('#new-game:not([disabled])').click();
        await waitForPlaying(page);
        await fireUntil(page, 'ammo', '98');
        await recording.continue();
        await page.waitForFunction(() => window.__exolonAudioSnapshot().decoded);
        await page.evaluate(async () => {
            for (let frame = 0; frame < 2; frame++)
                await new Promise<number>(requestAnimationFrame);
        });
        const snapshot = await page.evaluate(() => window.__exolonAudioSnapshot());
        assert.equal(snapshot.title, false);
        assert.equal(
            snapshot.loops,
            0,
            'A late modern-recording decode must not start music after the game begins',
        );
        console.log(
            'PASS: pending automatic modern recording never blocks gameplay or starts late title music.',
        );
    } finally {
        await page.close();
    }
}
async function checkFailedInitialization(session: Browser) {
    const page = await session.newPage();
    await prepare(page);
    let release!: (route: Route) => void;
    const world = new Promise<Route>((resolve) => {
        release = resolve;
    });
    await page.route(
        (url) => url.pathname === '/data/world.json',
        (route) => release(route),
    );
    const requests = titleRequests(page);
    try {
        await page.goto('http://127.0.0.1:8091/', { waitUntil: 'domcontentloaded' });
        await page.locator('[data-platform=retro][aria-disabled=false]').waitFor();
        await page.locator('[data-platform=retro]').press('Enter');
        await (
            await world
        ).fulfill({ status: 200, contentType: 'application/json', body: '{"screens":[]}' });
        await page.waitForFunction(() =>
            document.getElementById('platform-status')!.textContent!.includes('Could not'),
        );
        assert.equal(
            await page.locator('#platform-picker').isVisible(),
            true,
            'Invalid world reopens a visible chooser error',
        );
        assert.equal(
            await page.locator('[data-platform=retro]').getAttribute('aria-disabled'),
            'true',
        );
        await page.keyboard.press('Escape');
        await page.locator('[data-platform=retro]').press('Enter');
        assert.equal(await page.locator('#platform-picker').isVisible(), true);
        assert.deepEqual(requests, [], 'Failed initialization never requests title music');
        const snapshot = await page.evaluate(() => window.__exolonAudioSnapshot());
        assert.equal(snapshot.loops, 0);
        assert.deepEqual(
            snapshot.states,
            ['closed'],
            'Failed initialization closes the context unlocked by the initial banner gesture',
        );
        await page.locator('[data-platform=amiga][aria-disabled=false]').press('Enter');
        await page
            .locator('[data-game=amiga] #new-game:not([disabled])')
            .waitFor({ state: 'attached' });
        console.log(
            'PASS: invalid world leaves a visible chooser error, disables classic banners, closes its unlocked audio context and can recover to Amiga; Escape is safe.',
        );
    } finally {
        await page.close();
    }
}
async function checkMissingMusic(session: Browser) {
    const page = await session.newPage();
    await prepare(page);
    for (const filename of ALL_TITLE_FILES)
        await page.route(`**/${filename}*`, (route) => route.abort());
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.locator('#game').click();
        await page.waitForFunction(() =>
            (document.getElementById('music-status') as HTMLElement).textContent!.includes(
                'Music unavailable',
            ),
        );
        assert.equal(await page.locator('#music').count(), 0);
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).loops, 0);
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await fireUntil(page, 'ammo', '98');
    } finally {
        await page.close();
    }
}
async function checkRecordingFallbacks(session: Browser, name: string) {
    for (const failure of ['fetch', 'decode']) {
        const page = await session.newPage({ hasTouch: name === 'WebKit' });
        await prepare(page);
        await page.addInitScript(() => localStorage.setItem('exolon-graphics', 'remastered'));
        const requests = titleRequests(page);
        await page.route(`**/${AMBIENT_TITLE}*`, (route) =>
            failure === 'decode'
                ? route.fulfill({ status: 200, contentType: 'audio/mp4', body: 'invalid AAC' })
                : route.fulfill({ status: 404, body: '' }),
        );
        try {
            await openGame(page, 'http://127.0.0.1:8091/');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await page.locator('#game').focus();
            await page.keyboard.press('x');
            await expectMusic(page, `${name} ambient ${failure} fallback`, 'original');
            assert.deepEqual(requests, [AMBIENT_TITLE, ORIGINAL_TITLE]);
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} unavailable or undecodable ambient falls back to preserved original without other arrangements.`,
    );
}
async function checkMissingAudio(session: Browser) {
    const page = await session.newPage();
    await prepare(page);
    await page.addInitScript(() => {
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext = undefined;
        window.webkitAudioContext = undefined;
    });
    try {
        await begin(page);
        await page.waitForFunction(() =>
            (document.getElementById('mission-status') as HTMLElement).textContent!.includes(
                'UNAVAILABLE',
            ),
        );
        await fireUntil(page, 'ammo', '98');
    } finally {
        await page.close();
    }
}

async function checkMusicSelection(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: touch,
    });
    await prepare(page);
    await page.addInitScript(() => {
        if (!localStorage.getItem('exolon-music')!)
            localStorage.setItem('exolon-music', 'organ-lead');
    });
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    const requests = titleRequests(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await activate('#game');
        await expectMusic(page, `${name} Retro`);
        assert.equal(
            await page.locator('#music-selection').count(),
            0,
            'There is no music chooser',
        );
        assert.deepEqual(
            requests,
            [ORIGINAL_TITLE],
            'Legacy music preference cannot override graphics',
        );
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        await expectMusic(page, `${name} Remastered`, 'ambient');
        const loops = (await page.evaluate(() => window.__exolonAudioSnapshot())).loops;
        await activate('#show-scores');
        await expectMusic(page, `${name} records`, 'ambient');
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).loops, loops);
        await activate('#sound');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        assert.equal(
            (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
            0,
            'Switching cannot defeat mute',
        );
        await activate('#sound');
        await expectMusic(page, `${name} unmuted Retro`);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        await expectMusic(page, `${name} before reload`, 'ambient');
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.locator('#game').focus();
        await page.keyboard.press('x');
        await expectMusic(page, `${name} saved graphics`, 'ambient');
        await activate('#new-game');
        await waitForPlaying(page);
        await fireUntil(page, 'ammo', '98');
        const effect = await page.evaluate(() =>
            window.__exolonAudio.filter((record) => record.started && !record.loop).at(-1),
        );
        assert.equal(effect!.channels, 2);
        assert.ok(effect!.stereoDifference! > 0.001 && effect!.peak > 0.1 && effect!.peak < 0.95);
        await activate('#pause');
        const supplies = (await page.locator('#hud').textContent())!;
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        assert.equal(await overlayOpen(page), true);
        assert.equal((await page.locator('#hud').textContent())!, supplies);
        assert.equal(
            (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
            0,
            'Switching on pause cannot start title music',
        );
        await activate('#pause');
        await fireUntil(page, 'ammo', '97');
        const retro = await page.evaluate(() =>
            window.__exolonAudio.filter((record) => record.started && !record.loop).at(-1),
        );
        assert.equal(retro!.channels, 1);
        await page.keyboard.press('Escape');
        await expectMusic(page, `${name} menu return`);
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
            );
        }
        console.log(
            `PASS: ${name} graphics-linked original/ambient, no music selector, legacy preference ignored, mute/reload/records, stereo gameplay effects and paused live switch.`,
        );
    } finally {
        await page.close();
    }
}

async function checkTvMusicPlatforms(session: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await session.newPage({
            userAgent:
                'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager',
            viewport: { width: 1280, height: 720 },
        });
        await prepare(page);
        try {
            await openGame(page, `http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            await expectMusic(page, `${name} webOS initial title`);
            await page.locator('#sound').focus();
            await page.keyboard.press('Enter');
            await openSettings(page);
            await page.locator('#graphics-mode').focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.graphics === 'c64',
            );
            assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).audible, 0);
            await page.locator('#sound').focus();
            await page.keyboard.press('Enter');
            await openHome(page);
            await page.locator('#show-scores').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.menu === 'scores',
            );
            await page.waitForFunction(() => window.__exolonAudioSnapshot().audible === 1);
            assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).active, 1);

            for (const mode of [
                'cpc',
                'sharp-mz800',
                'gameboy',
                'gameboy-color',
                'amiga',
                'atari-st',
                'remastered',
                'retro',
            ]) {
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption(mode);
                await page.waitForFunction(
                    (mode) => document.getElementById('game')?.dataset.graphics === mode,
                    mode,
                );
                await page.waitForFunction(() => window.__exolonAudioSnapshot().audible === 1);
                const before = await page.evaluate(() => window.__exolonAudioSnapshot());
                assert.equal(before.active, 1, `${name} ${mode}: previous music is stopped`);
                if (await page.locator('#settings-toggle[aria-expanded="false"]').count()) {
                    await page.locator('#settings-toggle').focus();
                    await page.keyboard.press('Enter');
                }
                if (mode === 'remastered') {
                    if (
                        await page
                            .locator('#back-title')
                            .evaluate((element) => !(element as HTMLElement).hidden)
                    ) {
                        await openHome(page);
                        await page.locator('#back-title').focus();
                        await page.keyboard.press('Enter');
                    }
                    await page.waitForFunction(
                        () => document.getElementById('game')?.dataset.menu === 'scores',
                        undefined,
                        { timeout: 20000 },
                    );
                } else if ((await page.locator('#game').getAttribute('data-menu')) !== 'scores') {
                    await openHome(page);
                    await page.locator('#show-scores').focus();
                    await page.keyboard.press('Enter');
                }
                const records = await page.evaluate(() => window.__exolonAudioSnapshot());
                assert.equal(records.audible, 1, `${name} ${mode}: records retain music`);
                assert.equal(records.loops, before.loops, `${name} ${mode}: no duplicate loop`);
            }
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} webOS remote unmute, all platform transitions and manual/idle records keep one audible music loop in modern/legacy builds.`,
    );
}

async function checkPendingSelection(session: Browser) {
    const page = await session.newPage();
    await prepare(page);
    let release!: (route: Route) => void;
    const pending = new Promise<Route>((resolve) => {
        release = resolve;
    });
    await page.route(`**/${AMBIENT_TITLE}*`, (route) => release(route));
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.locator('#game').click();
        await expectMusic(page, 'Before pending mode change');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        const route = await pending;
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        await expectMusic(page, 'Newest graphics mode wins');
        await route.continue();
        await page.waitForFunction(
            () =>
                window.__exolonAudioDecodes.filter((record) => record.done && record.ok).length ===
                3,
        );
        await expectMusic(page, 'Late ambient remains cancelled');
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).loops, 2);
        console.log(
            'PASS: late native decode from an old graphics mode cannot replace or overlap the current title track.',
        );
    } finally {
        await page.close();
    }
}

async function checkHighScores(session: Browser, name: string) {
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 } });
    await prepare(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(async () => {
            const [{ createRenderer }, graphics] = await Promise.all([
                import(new URL('./view/renderer.js', document.baseURI).href),
                fetch('./assets/graphics/zx-spectrum/graphics.json').then((response) =>
                    response.json(),
                ),
            ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, graphics);
            const rows = Array.from({ length: 50 }, () => ({ name: 'PLAYER', score: 123456 }));
            try {
                for (const offset of [0.25, 0.5, 0.75, 1.5, 7.5, 40.5, 44]) {
                    renderer.renderTitle(0, { scores: true, rows, offset });
                    const pixels = canvas.getContext('2d')!.getImageData(0, 0, 256, 192).data;
                    let bottomInk = 0,
                        upperInk = 0;
                    for (let y = 32; y < 192; y++)
                        for (let x = 144; x < 192; x++) {
                            const p = (y * 256 + x) * 4;
                            if (!(pixels[p] || pixels[p + 1] || pixels[p + 2])) continue;
                            if (pixels[p] !== 255 || pixels[p + 1] !== 0 || pixels[p + 2] !== 255) {
                                throw Error(
                                    `Score digits changed colour at ${x},${y}, scroll=${offset}: ${Array.from(pixels.slice(p, p + 3))}`,
                                );
                            }
                            if (y >= 184) bottomInk++;
                            if (y < 64) upperInk++;
                        }
                    if (!upperInk)
                        throw Error(
                            'The source score scroll must reach row 32, directly below the logo',
                        );
                    if (offset % 1 && rows.length - offset >= 10 && !bottomInk)
                        throw Error(
                            'The regression must exercise digits entering the bottom attribute row',
                        );
                    for (let y = 184; y < 192; y++)
                        for (let x = 64; x < 128; x++) {
                            const p = (y * 256 + x) * 4;
                            if (
                                (pixels[p] || pixels[p + 1] || pixels[p + 2]) &&
                                (pixels[p] !== 0 || pixels[p + 1] !== 255 || pixels[p + 2] !== 0)
                            ) {
                                throw Error('Fixing score colours recoloured the player names');
                            }
                        }
                }
            } finally {
                renderer.destroy();
            }
        });
        await page.locator('#game').click();
        await expectMusic(page, `${name} before scores`);
        const musicLoops = await page.evaluate(() => window.__exolonAudioSnapshot().loops);
        await page.waitForFunction(
            () => document.getElementById('game')?.dataset.menu === 'scores',
            undefined,
            { timeout: 16000 },
        );
        assert.equal(await page.locator('#score-list li').count(), 50);
        assert.equal(await page.locator('#score-list li').first().innerText(), 'RAFFAELE\n001000');
        assert.ok((await page.locator('#score-list li').last().innerText()).includes('HUMPTY'));
        assert.equal(await menuPresented(page, 'title-intro'), false);
        assert.equal(
            await page.evaluate(() => window.__exolonAudioSnapshot().loops),
            musicLoops,
            'Attract transition must reuse the same music source',
        );
        await page.waitForFunction(() => {
            const transform = getComputedStyle(
                document.getElementById('score-list') as HTMLElement,
            ).transform;
            return (
                transform !== 'none' && Number(transform.split(',').at(-1)!.replace(')', '')) < -10
            );
        });
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await openHome(page);
        await page.locator('#show-scores').click();
        await openHome(page);
        await page.locator('#new-game').focus();
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await openHome(page);
        await page.locator('#show-scores').click();
        await openHome(page);
        await page.locator('#back-title').focus();
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await openHome(page);
        await page.locator('#show-scores').click();
        await expectMusic(page, `${name} manual scores`);
        assert.equal(await menuPresented(page, 'high-scores'), true);
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await openHome(page);
        await page.locator('#show-scores').click();
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            const fits = await page.evaluate(() => {
                const parent = document.querySelector('.game-footer')!.getBoundingClientRect();
                return ['high-scores', 'new-game', 'back-title'].every((id) => {
                    const rect = (
                        document.getElementById(id) as HTMLElement
                    ).getBoundingClientRect();
                    return (
                        rect.left >= parent.left &&
                        rect.right <= parent.right &&
                        rect.top >= parent.top &&
                        rect.bottom <= parent.bottom
                    );
                });
            });
            assert.ok(fits, `${name}: records must fit ${width}px`);
            await page.screenshot({
                path: `/tmp/exolon-high-scores-${name.toLowerCase()}-${width}.png`,
                fullPage: true,
            });
        }
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await page.keyboard.down('Space');
        try {
            await page.waitForFunction(
                () => Number((document.getElementById('score') as HTMLElement).textContent!) > 0,
            );
        } finally {
            await page.keyboard.up('Space');
        }
        const earned = Number(await page.locator('#score').innerText());
        await openHome(page);
        await page.locator('#menu').click();
        await openHome(page);
        await page.locator('#show-scores').click();
        assert.equal(Number(await page.locator('#scores-last').innerText()), earned);
        assert.equal(Number(await page.locator('#scores-best').innerText()), earned);
        await reloadGame(page);
        await page.locator('#show-scores:not([disabled])').waitFor({ state: 'attached' });
        await openHome(page);
        await page.locator('#show-scores').click();
        assert.equal(Number(await page.locator('#scores-best').innerText()), earned);
        console.log(
            `PASS: ${name} automatic/native scrolling records, 50 original rows, source bitmap graphics, music continuity, 320/390px, real ${earned}-point score and saved best.`,
        );
    } finally {
        await page.close();
    }
    for (const stored of ['2500', 'broken', 'blocked']) {
        const safePage = await session.newPage();
        await prepare(safePage);
        await safePage.addInitScript((value) => {
            if (value === 'blocked')
                Storage.prototype.getItem = Storage.prototype.setItem = () => {
                    throw new Error('Storage disabled');
                };
            else localStorage.setItem('exolon-best-score', value);
        }, stored);
        try {
            await openGame(safePage, 'http://127.0.0.1:8091/');
            await safePage.locator('#show-scores:not([disabled])').waitFor({ state: 'attached' });
            await openHome(safePage);
            await safePage.locator('#show-scores').click();
            assert.equal(await safePage.locator('#score-list li').count(), 50);
            assert.equal(
                Number(await safePage.locator('#scores-best').innerText()),
                stored === '2500' ? 2500 : 0,
            );
            assert.ok(
                (await safePage.locator('#score-list li').first().innerText()).includes(
                    stored === '2500' ? 'PLAYER' : 'RAFFAELE',
                ),
            );
            await openHome(safePage);
            await safePage.locator('#back-title').click();
            assert.equal(await menuPresented(safePage, 'title-intro'), true);
        } finally {
            await safePage.close();
        }
    }
}

async function virtualGamepads(page: Page, mode = 'standard') {
    // Only the hardware boundary is a fixture. Input, model, RAF and audio stay real.
    await page.addInitScript((mode) => {
        window.__exolonVirtualPad = {
            id: 'Virtual standard controller',
            index: 0,
            connected: true,
            mapping: mode === 'nonstandard' ? '' : 'standard',
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        };
        window.__exolonVirtualPads = [window.__exolonVirtualPad];
        Object.defineProperty(Navigator.prototype, 'getGamepads', {
            configurable: true,
            value:
                mode === 'absent'
                    ? undefined
                    : function () {
                          if (mode === 'blocked')
                              throw new DOMException('Gamepad access denied', 'SecurityError');
                          return window.__exolonVirtualPads.slice();
                      },
        });
    }, mode);
}
async function padFrames(page: Page, count = 3) {
    await page.evaluate(async (count) => {
        for (let frame = 0; frame < count; frame++)
            await new Promise<number>(requestAnimationFrame);
    }, count);
}
async function padButton(
    page: Page,
    index: number,
    pressed: boolean,
    value: number = pressed ? 1 : 0,
) {
    await page.evaluate(
        ({ index, pressed, value }) => {
            window.__exolonVirtualPad.buttons[index] = { pressed, value };
        },
        { index, pressed, value },
    );
    await padFrames(page);
}
async function checkGamepad(session: Browser, name: string) {
    const page = await session.newPage({ hasTouch: name === 'WebKit' });
    await prepare(page);
    await virtualGamepads(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.waitForFunction(
            () =>
                (document.getElementById('notifications') as HTMLElement).textContent! ===
                'Gamepad connected: Virtual standard controller',
        );
        const notice = page.locator('#notifications');
        assert.equal(await notice.isVisible(), true, 'Connection notice is visible in the footer');
        assert.equal(await notice.innerText(), 'Gamepad connected: Virtual standard controller');
        assert.equal(
            await notice.evaluate((element: HTMLElement) => Boolean(element.closest('footer'))),
            true,
        );
        await notice.waitFor({ state: 'hidden', timeout: 5000 });
        await padFrames(page, 8);
        assert.equal(
            await notice.isVisible(),
            false,
            'Polling does not repeat the connection notice',
        );
        assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
        await padButton(page, 0, true);
        await waitForPlaying(page);
        await padFrames(page, 8);
        assert.equal(await menuPresented(page, 'title-screen'), false);
        assert.equal(await page.locator('#ammo').innerText(), '99');
        await padButton(page, 0, false);
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await padFrames(page);
        await padButton(page, 3, true);
        assert.equal(await menuPresented(page, 'high-scores'), true);
        await padFrames(page, 8);
        assert.equal(await menuPresented(page, 'high-scores'), true);
        await padButton(page, 3, false);
        await padButton(page, 1, true);
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await padButton(page, 1, false);
        await padButton(page, 4, true);
        await padButton(page, 4, false);
        assert.equal(await page.locator('#music-selection').count(), 0);
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'retro');
        await padButton(page, 5, true);
        await waitForPlaying(page);
        await padFrames(page, 8);
        assert.equal(await page.locator('#ammo').innerText(), '99');
        await padButton(page, 5, false);
        await padButton(page, 5, true);
        // Three display frames need not include a simulation tick at every platform rate.
        await page.waitForFunction(
            () => (document.getElementById('ammo') as HTMLElement).textContent! === '98',
        );
        await padButton(page, 5, false);
        // A gamepad must not bypass autoplay policy. A real canvas gesture can
        // unlock sound after a controller-only start on restrictive browsers.
        if (name === 'WebKit') await page.locator('#game').tap();
        else await page.locator('#game').click();
        await padButton(page, 7, false, 0.7);
        await page.waitForFunction(
            () => (document.getElementById('grenades') as HTMLElement).textContent! === '09',
        );
        assert.equal(await page.locator('#ammo').innerText(), '98');
        await padButton(page, 7, false, 0);
        assert.ok((await page.evaluate(() => window.__exolonAudioSnapshot())).effects > 0);
        await padButton(page, 9, true);
        assert.equal(await overlayOpen(page), true);
        const pausedAmmo = await page.locator('#ammo').innerText();
        await padFrames(page, 12);
        assert.equal(await overlayOpen(page), true);
        assert.equal(await page.locator('#ammo').innerText(), pausedAmmo);
        await padButton(page, 9, false);
        await padButton(page, 9, true);
        await waitForPlaying(page);
        await padFrames(page, 8);
        assert.equal(await overlayOpen(page), false);
        await padButton(page, 9, false);
        await page.evaluate(() => {
            window.__exolonVirtualPads = [];
        });
        await padFrames(page);
        assert.equal(await notice.isVisible(), true);
        assert.equal(await notice.innerText(), 'Gamepad disconnected: Virtual standard controller');
        assert.equal(await overlayOpen(page), true);
        assert.ok(
            (await page.locator('#overlay-title').innerText()).includes('Gamepad disconnected'),
        );
        await activateControl(page.locator('#pause'));
        await waitForPlaying(page);
        const ammo = Number(await page.locator('#ammo').innerText());
        await fireUntil(page, 'ammo', String(ammo - 1).padStart(2, '0'));
        await page.evaluate(() => {
            window.__exolonVirtualPad.buttons[9] = { pressed: true, value: 1 };
            window.__exolonVirtualPads = [window.__exolonVirtualPad];
        });
        await padFrames(page, 8);
        assert.equal(await notice.isVisible(), true);
        assert.equal(await notice.innerText(), 'Gamepad connected: Virtual standard controller');
        assert.equal(await overlayOpen(page), false, 'Held reconnect must not pause or resume');
        await padButton(page, 9, false);
        await page.evaluate(() => {
            window.__exolonPadHidden = true;
            Object.defineProperty(document, 'hidden', {
                configurable: true,
                get: () => window.__exolonPadHidden,
            });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await padButton(page, 9, true);
        assert.equal(await overlayOpen(page), true);
        await page.evaluate(() => {
            window.__exolonPadHidden = false;
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await padFrames(page, 8);
        assert.equal(await overlayOpen(page), true);
        await padButton(page, 9, false);
        await padButton(page, 9, true);
        await waitForPlaying(page);
        await padButton(page, 9, false);
        await padButton(page, 9, true);
        await padButton(page, 9, false);
        await padButton(page, 1, true);
        assert.equal(await menuPresented(page, 'title-screen'), true);
        assert.equal(await overlayOpen(page), false);
        await notice.waitFor({ state: 'hidden', timeout: 5000 });
        await page.evaluate(() => {
            const gamepad = { id: 'Secondary controller', index: 1 };
            const event = new Event('gamepadconnected');
            Object.defineProperty(event, 'gamepad', { value: gamepad });
            window.dispatchEvent(event);
        });
        assert.equal(await notice.innerText(), 'Gamepad connected: Secondary controller');
        assert.equal(await notice.isVisible(), true);
        await page.evaluate(() => {
            const gamepad = { id: 'Secondary controller', index: 1 };
            const event = new Event('gamepaddisconnected');
            Object.defineProperty(event, 'gamepad', { value: gamepad });
            window.dispatchEvent(event);
        });
        assert.equal(await notice.innerText(), 'Gamepad disconnected: Secondary controller');
        await notice.waitFor({ state: 'hidden', timeout: 5000 });
        console.log(
            `PASS: ${name} virtual Standard Gamepad menu/music persistence, controller-only start, shot/rocket, native audio after gesture, held Start, disconnect/reconnect and hidden gating.`,
        );
        console.log(
            `PASS: ${name} timed footer connection/disconnection notices, polling deduplication and secondary controller events.`,
        );
    } finally {
        await page.close();
    }
    for (const mode of ['absent', 'blocked', 'nonstandard', 'unused-disconnect']) {
        const fallback = await session.newPage();
        await prepare(fallback);
        await virtualGamepads(fallback, mode);
        try {
            await begin(fallback);
            if (mode === 'unused-disconnect') {
                await fallback.evaluate(() => {
                    window.__exolonVirtualPads = [];
                });
                await padFrames(fallback, 8);
                assert.equal(
                    await overlayOpen(fallback),
                    false,
                    'An unused controller must not interrupt keyboard play',
                );
            }
            await fireUntil(fallback, 'ammo', '98');
        } finally {
            await fallback.close();
        }
    }
}
async function checkEffects(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: touch,
    });
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    const errorCount = errors.length;
    await prepare(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        const result = await page.evaluate(async () => {
            const [{ createRenderer, createStaticScene }, { createState }, world, graphics] =
                await Promise.all([
                    import(new URL('./view/renderer.js', document.baseURI).href),
                    import(new URL('./model/state.js', document.baseURI).href),
                    fetch('./data/world.json').then((response) => response.json()),
                    fetch('./assets/graphics/zx-spectrum/graphics.json').then((response) =>
                        response.json(),
                    ),
                ]);
            const failures = [];
            const check = (condition: boolean, message: string) => {
                if (!condition) failures.push(message);
            };
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, graphics);
            const context = canvas.getContext('2d')!;
            const pixels = () => context.getImageData(0, 0, 256, 192).data;
            const same = (
                a: Uint8Array | Uint8ClampedArray | readonly number[],
                b: ArrayLike<number>,
            ) => a.length === b.length && a.every((value, index) => value === b[index]);
            // This reference reads original SCR bytes directly, independently of the compositor.
            const reference = new Uint8ClampedArray(256 * 192 * 4);
            for (let y = 0; y < 192; y++)
                for (let x = 0; x < 256; x++) {
                    const byte =
                        graphics.loading[(y & 192) * 32 + (y & 7) * 256 + (y & 56) * 4 + (x >> 3)];
                    const attribute = graphics.loading[6144 + (y >> 3) * 32 + (x >> 3)];
                    const color = byte & (128 >> (x & 7)) ? attribute & 7 : (attribute >> 3) & 7;
                    const level = attribute & 64 ? 255 : 205,
                        offset = (y * 256 + x) * 4;
                    reference.set(
                        [color & 2 ? level : 0, color & 4 ? level : 0, color & 1 ? level : 0, 255],
                        offset,
                    );
                }
            renderer.renderTitle(0);
            const loading = pixels().slice();
            for (const [x, y] of [
                [36, 0],
                [68, 4],
                [108, 8],
                [127, 24],
                [70, 80],
                [165, 81],
                [58, 145],
            ]) {
                const pixel = (y * 256 + x) * 4;
                check(
                    loading.slice(pixel, pixel + 3).every((value) => value === 0),
                    'Baked loading-screen star remains visible',
                );
            }
            for (const [x, y, w, h] of [
                [0, 0, 24, 24],
                [208, 0, 32, 32],
                [72, 8, 32, 32],
                [157, 40, 24, 24],
                [136, 160, 32, 32],
                [0, 184, 256, 8],
            ]) {
                for (let yy = y; yy < y + h; yy++)
                    for (let xx = x; xx < x + w; xx++) {
                        const pixel = (yy * 256 + xx) * 4;
                        check(
                            same(
                                loading.slice(pixel, pixel + 4),
                                reference.slice(pixel, pixel + 4),
                            ),
                            'Star cleanup altered original planet or credits',
                        );
                    }
            }
            let animatedPixels = 0;
            for (const time of [100, 300, 700, 1500, 1800, 2500]) {
                renderer.renderTitle(time);
                const animated = pixels();
                for (let offset = 0; offset < animated.length; offset += 4) {
                    const originalInk =
                        loading[offset] || loading[offset + 1] || loading[offset + 2];
                    if (originalInk)
                        check(
                            same(
                                animated.slice(offset, offset + 4),
                                loading.slice(offset, offset + 4),
                            ),
                            'Title flare overwrites original artwork',
                        );
                    else if (animated[offset] || animated[offset + 1] || animated[offset + 2]) {
                        check(
                            animated[offset] === 255 &&
                                animated[offset + 1] === 255 &&
                                animated[offset + 2] === 255,
                            'Animated title star is not original bright white',
                        );
                        animatedPixels++;
                    }
                }
            }
            check(animatedPixels > 50, 'Original animated title stars never appear');
            renderer.renderTitle(0, { scores: true });
            const scorePixels = pixels().slice();
            let sideChecks = 0;
            for (const tile of graphics.screens.scores) {
                if (tile.x >= 8 && tile.x < 24) continue;
                for (let row = 0; row < 8; row++)
                    for (let bit = 0; bit < 8; bit++) {
                        const x = tile.x * 8 + bit,
                            y = tile.y * 8 + row,
                            offset = (y * 256 + x) * 4;
                        const color =
                            tile.bitmap[row] & (128 >> bit)
                                ? tile.color & 7
                                : (tile.color >> 3) & 7;
                        const level = tile.color & 64 ? 255 : 205;
                        check(
                            scorePixels[offset] === (color & 2 ? level : 0) &&
                                scorePixels[offset + 1] === (color & 4 ? level : 0) &&
                                scorePixels[offset + 2] === (color & 1 ? level : 0),
                            'score-side source bitmap or attribute differs',
                        );
                        sideChecks++;
                    }
            }
            const rows = Array.from({ length: 12 }, (_, i) => ({
                name: `PLAYER${i}`,
                score: 123456,
            }));
            let recordStarPixels = 0;
            for (const scrollOffset of [0, 1.75, 7]) {
                renderer.renderTitle(0, {
                    scores: true,
                    rows,
                    offset: scrollOffset,
                    bestScore: 999999,
                });
                const base = pixels().slice();
                for (const time of [100, 300, 700, 1500, 1800, 2500]) {
                    renderer.renderTitle(time, {
                        scores: true,
                        rows,
                        offset: scrollOffset,
                        bestScore: 999999,
                    });
                    const animated = pixels();
                    for (let pixel = 0; pixel < animated.length; pixel += 4) {
                        const x = (pixel / 4) % 256,
                            y = Math.floor(pixel / 4 / 256);
                        if (
                            (x >= 64 && x < 192 && y >= 32) ||
                            base[pixel] ||
                            base[pixel + 1] ||
                            base[pixel + 2]
                        ) {
                            check(
                                same(
                                    animated.slice(pixel, pixel + 4),
                                    base.slice(pixel, pixel + 4),
                                ),
                                'Record flare overwrites scrolling names, scores, logo or planets',
                            );
                        } else if (animated[pixel] || animated[pixel + 1] || animated[pixel + 2]) {
                            check(
                                animated[pixel] === 255 &&
                                    animated[pixel + 1] === 255 &&
                                    animated[pixel + 2] === 255,
                                'Record star is not original bright white',
                            );
                            recordStarPixels++;
                        }
                    }
                }
            }
            check(recordStarPixels > 50, 'Animated stars never appear on records');
            renderer.renderTitle(0);
            check(same(pixels(), loading), 'loading screen did not restore after scores');
            const colors = new Set();
            let staticTiles = 0,
                starCount = 0;
            for (let index = 0; index < 125; index++) {
                const state = createState(world, { screenIndex: index }),
                    scene = createStaticScene(state, graphics);
                for (const [offset, tile] of state.screen.tiles.entries()) {
                    if (!tile || offset >= 704) continue;
                    staticTiles++;
                    if (!tile.color) continue;
                    const glyph = graphics.shapes[tile.shape || 0];
                    for (let row = 0; row < 8; row++)
                        for (let bit = 0; bit < 8; bit++) {
                            const actual =
                                scene.bits[
                                    ((offset >> 5) * 8 + row) * 256 + (offset % 32) * 8 + bit
                                ];
                            if (actual !== ((glyph[row] >> (7 - bit)) & 1)) {
                                failures.push(`screen ${index} tile ${offset} bitmap differs`);
                                break;
                            }
                        }
                    check(
                        scene.attributes[offset] === (tile.color || 0),
                        `screen ${index} tile ${offset} attribute differs`,
                    );
                }
                for (let row = 0; row < 22; row++) {
                    let stars = 0;
                    for (let column = 0; column < 32; column++) {
                        const offset = row * 32 + column,
                            tile = state.screen.tiles[offset];
                        if (tile?.color || !scene.attributes[offset]) continue;
                        check(
                            scene.background[offset] === 0,
                            `screen ${index} star overwrote immutable background attributes`,
                        );
                        check(
                            [0x42, 0x43, 0x46, 0x47].includes(scene.attributes[offset]),
                            `screen ${index} non-source star attribute`,
                        );
                        for (let y = 0; y < 8; y++)
                            for (let bit = 0; bit < 8; bit++) {
                                check(
                                    scene.bits[(row * 8 + y) * 256 + column * 8 + bit] ===
                                        ((graphics.star[y] >> (7 - bit)) & 1),
                                    `screen ${index} non-source star glyph`,
                                );
                            }
                        stars++;
                        starCount++;
                    }
                    check(stars <= 3, `screen ${index} row ${row} contains more than three stars`);
                }
                const repeat = createStaticScene(state, graphics);
                check(
                    same(scene.bits, repeat.bits) && same(scene.attributes, repeat.attributes),
                    `screen ${index} star placement changes between renders`,
                );
                renderer.render(state, 0);
                for (let offset = 0, data = pixels(); offset < data.length; offset += 4) {
                    const channels = [data[offset], data[offset + 1], data[offset + 2]],
                        levels = channels.filter(Boolean);
                    if (
                        data[offset + 3] !== 255 ||
                        levels.some((value) => value !== 205 && value !== 255) ||
                        new Set(levels).size > 1
                    ) {
                        failures.push(`screen ${index} contains non-Spectrum colors`);
                        break;
                    }
                    colors.add(channels.join(','));
                }
            }
            const state = createState({
                tiles: Array.from({ length: 704 }, (_, index) => ({
                    shape: 0,
                    color: 0x47,
                    overlay: 255,
                    instance: index,
                    collision: 0,
                    block: 0,
                })),
                objects: [],
            });
            state.player = { ...state.player, x: 40, y: 64 };
            const checkSprite = (
                bytes: Bytes,
                width: number,
                height: number,
                x: number,
                y: number,
                mirror: boolean,
                label: string,
            ) => {
                const data = pixels();
                let lit = 0;
                for (let row = 0; row < height; row++)
                    for (let column = 0; column < width; column++) {
                        const source = mirror ? width - 1 - column : column;
                        const expected = Boolean(
                            bytes[(row * width) / 8 + (source >> 3)] & (128 >> (source & 7)),
                        );
                        const offset = ((y + row) * 256 + x + column) * 4,
                            actual =
                                data[offset] !== 0 ||
                                data[offset + 1] !== 0 ||
                                data[offset + 2] !== 0;
                        if (expected !== actual) {
                            failures.push(`${label}: source pixel differs at ${column},${row}`);
                            return;
                        }
                        if (actual) lit++;
                    }
                check(lit > 0 || bytes.every((value) => value === 0), `${label}: empty sprite`);
            };
            for (let frame = 0; frame < 24; frame++)
                for (const direction of [1, -1]) {
                    state.player.sprite = frame % 12;
                    state.exoskeleton = frame >= 12;
                    state.player.direction = direction;
                    renderer.render(state, 0);
                    checkSprite(
                        graphics.player.slice(frame * 96, (frame + 1) * 96),
                        24,
                        32,
                        80,
                        64,
                        direction < 0,
                        `player frame ${frame}/${direction}`,
                    );
                }
            state.exoskeleton = false;
            state.player.x = 200;
            for (let id = 1; id < 45; id++) {
                state.enemies = [{ sprite: id, phase: 1, x: 40, y: 64, color: 0x47 }];
                renderer.render(state, 0);
                checkSprite(
                    graphics.small.slice(id * 32, (id + 1) * 32),
                    16,
                    16,
                    80,
                    64,
                    false,
                    `enemy frame ${id}`,
                );
            }
            state.enemies = [];
            state.objects = [{ id: 1, type: 2, active: true, x: 8, y: 4 }];
            renderer.render(state, 0);
            checkSprite(
                graphics.torch.slice(0, 16),
                8,
                16,
                64,
                40,
                false,
                'original two-cell ship exhaust',
            );
            for (const [phase, frame] of [
                [9, 0],
                [8, 7],
                [7, 6],
                [6, 5],
                [5, 4],
                [4, 3],
                [3, 2],
                [2, 1],
                [1, 0],
            ]) {
                state.objects = [{ id: 3, type: 3, active: true, x: 8, y: 4, phase }];
                renderer.render(state, 0);
                const bytes = Array.from(
                    { length: 16 },
                    (_, index) => graphics.turret[frame * 16 + (index & 1) * 8 + (index >> 1)],
                );
                checkSprite(bytes, 16, 8, 64, 32, false, `source cannon recoil phase ${phase}`);
                const data = pixels();
                for (let row = 0; row < 8; row++)
                    for (let column = 0; column < 16; column++) {
                        if (!(bytes[row * 2 + (column >> 3)] & (128 >> (column & 7)))) continue;
                        const offset = ((32 + row) * 256 + 64 + column) * 4,
                            level = column < 8 ? 255 : 205;
                        check(
                            data[offset] === level &&
                                data[offset + 1] === level &&
                                data[offset + 2] === 0,
                            'Cannon barrel source attribute differs',
                        );
                    }
                const paused = pixels().slice();
                renderer.render(state, 100, 0.7);
                check(same(paused, pixels()), 'Cannon recoil moves without a simulation step');
            }
            for (let phase = 0; phase < 2; phase++) {
                state.tick = phase;
                state.objects = [{ id: 2, type: 5, active: false, x: 8, y: 4 }];
                renderer.render(state, 0);
                const bytes = Array.from(
                    { length: 16 },
                    (_, index) => graphics.mine[phase * 16 + (index & 1) * 8 + (index >> 1)],
                );
                checkSprite(bytes, 16, 8, 64, 32, false, `spent mine frame ${phase}`);
            }
            state.tick = 0;
            state.objects = [];
            for (const direction of [1, -1])
                for (let phase = 1; phase < 4; phase++) {
                    state.grenade = { x: 40 + phase, y: 64, dx: direction, phase: 0 };
                    renderer.render(state, 0);
                    const id = direction < 0 ? 1 : 0,
                        start = id * 64 + phase * 16;
                    checkSprite(
                        graphics.shifted.slice(start, start + 16),
                        16,
                        8,
                        80,
                        64,
                        false,
                        `grenade ${direction} shift ${phase}`,
                    );
                }
            state.grenade = null;
            for (const [kind, id] of [
                ['sphere', 7],
                ['launcher', 8],
            ] as const) {
                if (kind === 'sphere') state.spheres = [{ x: 41, y: 64 }];
                else state.rockets = [{ x: 41, y: 64, kind: 'launcher' }];
                renderer.render(state, 0);
                checkSprite(
                    graphics.shifted.slice(id * 64 + 16, id * 64 + 32),
                    16,
                    8,
                    80,
                    64,
                    false,
                    kind,
                );
                state.spheres = [];
                state.rockets = [];
            }
            renderer.destroy();
            state.tick = 0;
            renderer.addEvents([{ type: 'enemy-destroyed', x: 80, y: 64, points: 150 }], state);
            for (let age = 0; age < 10; age++) {
                state.tick = age;
                renderer.addEvents([], state);
                renderer.render(state, 0);
                const id = [5, 5, 6, 6, 7, 7, 8, 8, 9, 9][age];
                checkSprite(
                    graphics.small.slice(id * 32, (id + 1) * 32),
                    16,
                    16,
                    80,
                    64,
                    false,
                    `source dissolve tick ${age}`,
                );
            }
            renderer.destroy();
            state.tick = 0;
            renderer.addEvents([{ type: 'explosion', x: 82, y: 64 }], state);
            for (let age = 0; age < 10; age++) {
                state.tick = age;
                renderer.addEvents([], state);
                renderer.render(state, 0);
                const id = [3, 4, 5, 3, 5, 4, 5, 5, 5, 6][age];
                checkSprite(
                    graphics.shifted.slice(id * 64 + 16, id * 64 + 32),
                    16,
                    8,
                    80,
                    64,
                    false,
                    `source particle tick ${age}`,
                );
            }
            renderer.destroy();
            state.tick = 0;
            // Two original debris particles begin together (XOR cancels), then
            // follow two constant velocities from the source delta set. Discover
            // the pair from pixels instead of copying the renderer RNG.
            state.objects = [];
            state.tick = 0;
            const target = 8 * 32 + 10;
            renderer.addEvents(
                [{ type: 'object-destroyed', instance: target, x: 80, y: 64 }],
                state,
            );
            renderer.render(state, 0);
            const area = () => {
                const data = pixels(),
                    bits = new Uint8Array(64 * 56);
                for (let y = 0; y < 56; y++)
                    for (let x = 0; x < 64; x++) {
                        const offset = ((40 + y) * 256 + 56 + x) * 4;
                        bits[y * 64 + x] = Number(
                            data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0,
                        );
                    }
                return bits;
            };
            check(
                area().every((value) => value === 0),
                'destroyed source cell did not create two coincident XOR particles',
            );
            const actual: Uint8Array[] = [];
            for (let age = 1; age <= 3; age++) {
                state.tick = age;
                renderer.addEvents([], state);
                renderer.render(state, 0);
                actual.push(area());
            }
            const candidates: Uint8Array[][] = [];
            for (const dx of [-8, -6, -4, 0, 4, 6, 8])
                for (const dy of [-8, -6, -4, 0, 4, 6, 8]) {
                    if (!dx && !dy) continue;
                    const masks = [];
                    for (let age = 1; age <= 3; age++) {
                        const x = 80 + age * dx,
                            y = 64 + age * dy,
                            phase = (Math.floor(x / 2) & 3) * 16,
                            aligned = Math.floor(x / 8) * 8;
                        const mask = new Uint8Array(64 * 56);
                        for (let row = 0; row < 8; row++)
                            for (let column = 0; column < 16; column++) {
                                const px = aligned + column - 56,
                                    py = y + row - 40;
                                if (px < 0 || px >= 64 || py < 0 || py >= 56) continue;
                                mask[py * 64 + px] =
                                    (graphics.shifted[128 + phase + row * 2 + (column >> 3)] >>
                                        (7 - (column & 7))) &
                                    1;
                            }
                        masks.push(mask);
                    }
                    candidates.push(masks);
                }
            const linearPair = candidates.some((first, index) =>
                candidates
                    .slice(index)
                    .some((second) =>
                        actual.every((mask, age) =>
                            mask.every(
                                (bit, pixel) => bit === (first[age][pixel] ^ second[age][pixel]),
                            ),
                        ),
                    ),
            );
            check(
                linearPair,
                'debris pixels do not match two source sprite-2 particles with constant source velocities',
            );
            check(
                actual.some((mask) => mask.some(Boolean)),
                'source debris never separated into visible particles',
            );
            renderer.destroy();
            state.tick = 0;
            // Independent original message decoder: cells plus original font pointer.
            const messagePixels = (tiles: GraphicTile[], pointer = -1) => {
                const bits = new Uint8Array(256 * 192),
                    attributes = new Uint8Array(768),
                    output = new Uint8ClampedArray(256 * 192 * 4);
                for (const tile of tiles) {
                    attributes[tile.y * 32 + tile.x] = tile.color || 0;
                    for (let row = 0; row < 8; row++)
                        for (let bit = 0; bit < 8; bit++)
                            bits[(tile.y * 8 + row) * 256 + tile.x * 8 + bit] =
                                (tile.bitmap[row] >> (7 - bit)) & 1;
                }
                if (pointer >= 0) {
                    const glyph = graphics.font.slice(10 * 8, 11 * 8),
                        y = 13 + pointer;
                    attributes[y * 32 + 22] = 0x47;
                    for (let row = 0; row < 8; row++)
                        for (let bit = 0; bit < 8; bit++)
                            bits[(y * 8 + row) * 256 + 176 + bit] = (glyph[row] >> (7 - bit)) & 1;
                }
                for (let y = 0; y < 192; y++)
                    for (let x = 0; x < 256; x++) {
                        const attribute = attributes[(y >> 3) * 32 + (x >> 3)],
                            color = bits[y * 256 + x] ? attribute & 7 : (attribute >> 3) & 7;
                        const level = attribute & 64 ? 255 : 205;
                        output.set(
                            [
                                color & 2 ? level : 0,
                                color & 4 ? level : 0,
                                color & 1 ? level : 0,
                                255,
                            ],
                            (y * 256 + x) * 4,
                        );
                    }
                return output;
            };
            state.status = 'bonus';
            for (let cursor = 0; cursor < 8; cursor++) {
                state.bonus = { cursor };
                renderer.render(state, 0);
                check(
                    same(pixels(), messagePixels(graphics.screens.bonus, cursor)),
                    `original bonus screen and pointer ${cursor} differ`,
                );
            }
            state.status = 'won';
            renderer.render(state, 0);
            check(
                same(pixels(), messagePixels(graphics.screens.hallOfFame)),
                'original Hall of Fame screen differs',
            );
            state.status = 'over';
            renderer.render(state, 0);
            const over = pixels(),
                message = messagePixels(graphics.screens.gameOver);
            for (const tile of graphics.screens.gameOver)
                for (let row = 0; row < 8; row++)
                    for (let bit = 0; bit < 8; bit++) {
                        const offset = ((tile.y * 8 + row) * 256 + tile.x * 8 + bit) * 4;
                        check(
                            over
                                .slice(offset, offset + 4)
                                .every((value, index) => value === message[offset + index]),
                            'original GAME OVER bitmap differs',
                        );
                    }
            state.status = 'playing';
            state.bonus = null;
            state.objects = [];
            state.player.x = 40;
            state.player.sprite = 5;
            renderer.render(state, 0, 0);
            const discrete = pixels().slice();
            renderer.render(state, 0, 0.8);
            check(same(discrete, pixels()), 'actor graphics interpolate between source ticks');
            // HUD digits use the same original font, including all eight pixel rows.
            const data = pixels(),
                glyph = graphics.font.slice(
                    ('9'.charCodeAt(0) - 32) * 8,
                    ('9'.charCodeAt(0) - 31) * 8,
                );
            for (let row = 0; row < 8; row++)
                for (let bit = 0; bit < 8; bit++) {
                    const offset = ((184 + row) * 256 + 8 + bit) * 4;
                    check(
                        Boolean(data[offset]) === Boolean(glyph[row] & (128 >> bit)),
                        'HUD ammo glyph differs from original font',
                    );
                }
            renderer.destroy();
            return {
                failures: failures.slice(0, 20),
                staticTiles,
                starCount,
                sideChecks,
                colors: colors.size,
                width: canvas.width,
                height: canvas.height,
            };
        });
        assert.deepEqual(result.failures, [], `${name}: original bitmap rendering`);
        assert.equal(result.width, 256);
        assert.equal(result.height, 192);
        assert.ok(result.staticTiles > 10000);
        assert.ok(result.sideChecks > 1000);
        assert.ok(result.starCount > 1000);
        assert.ok(result.colors >= 8 && result.colors <= 15);
        await page.waitForFunction(
            () =>
                (document.getElementById('game') as HTMLCanvasElement)
                    .getContext('2d')!
                    .getImageData(0, 0, 1, 1).data[3] === 255,
        );
        const initialTitle = await page
            .locator('#game')
            .evaluate((element: HTMLCanvasElement) => element.toDataURL());
        await page.waitForFunction(
            (before) =>
                (document.getElementById('game') as HTMLCanvasElement).toDataURL() !== before,
            initialTitle,
        );
        await page
            .locator('#game')
            .screenshot({ path: `/tmp/exolon-original-title-${name.toLowerCase()}.png` });
        await activate('#show-scores');
        await page
            .locator('#game')
            .screenshot({ path: `/tmp/exolon-original-scores-${name.toLowerCase()}.png` });
        await activate('#new-game');
        await waitForPlaying(page);
        await activate('#pause');
        await page
            .locator('#game')
            .screenshot({ path: `/tmp/exolon-original-game-${name.toLowerCase()}.png` });
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            const sizing = await page.locator('#game').evaluate((element: HTMLCanvasElement) => ({
                width: element.width,
                height: element.height,
                cssWidth: element.getBoundingClientRect().width,
                ratio:
                    element.getBoundingClientRect().width / element.getBoundingClientRect().height,
                smoothing: element.getContext('2d')!.imageSmoothingEnabled,
                rendering: getComputedStyle(element).imageRendering,
            }));
            assert.equal(sizing.width, 256);
            assert.equal(sizing.height, 192);
            assert.equal(sizing.smoothing, false);
            assert.ok(Math.abs(sizing.ratio - 4 / 3) < 0.01);
            assert.ok(sizing.cssWidth <= width);
            assert.equal(sizing.rendering, 'pixelated');
            await page.screenshot({
                path: `/tmp/exolon-original-mobile-${name.toLowerCase()}-${width}.png`,
                fullPage: true,
            });
        }
        assert.deepEqual(errors.slice(errorCount), []);
        console.log(
            `PASS: ${name} cleaned original title, animated record stars, source score planets, ${result.staticTiles} tiles and ${result.starCount} source stars across 125 screens, 48 mirrored astronaut frames, 44 enemy frames, source exhaust/HUD/projectiles/dissolve/particles/debris/mines/bonus/game-over, discrete motion, ${result.colors} Spectrum colors and 320/390px.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-original-${name.toLowerCase()}-failure.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
// Chromium/Firefox cover mouse controls; the focused WebKit settings/footer checks cover touch.
const cheatOptionIds = [
    'infiniteLives',
    'infiniteRockets',
    'infiniteAmmo',
    'invulnerable',
    'levelSelection',
    'retryLevel',
] as const;
async function activateGameControl(page: Page, selector: string, touch = false) {
    const control = page.locator(selector);
    if (selector === '#pause' && /^(Pause|Resume)$/.test((await control.textContent()) || '')) {
        await closeHome(page);
        await closeSettings(page);
        await page.locator('#game').focus();
        await page.keyboard.press('Pause');
        return;
    }
    await prepareControl(control);
    if (touch) await control.tap();
    else await control.click();
}
async function chooseCheats(page: Page, options: boolean | Partial<Cheats>, touch = false) {
    await openSettings(page);
    for (const key of cheatOptionIds) {
        const field = page.locator(`[data-cheat="${key}"]`),
            checked = options === true || (options as Partial<Cheats>)?.[key] === true;
        if (touch) {
            if ((await field.isChecked()) !== checked) await field.tap();
        } else await field.setChecked(checked);
    }
    await closeSettings(page);
}
async function checkCheatSettings(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: touch,
    });
    await prepare(page);
    async function activate(selector: string) {
        const control = page.locator(selector);
        await prepareControl(control);
        if (touch) await control.tap();
        else await control.click();
    }
    async function choose(options: boolean | Partial<Cheats>) {
        await openSettings(page);
        await chooseCheats(page, options, touch);
    }
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await openSettings(page);
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        const group = dialog.getByRole('group', { name: 'CHEAT MODE', exact: true });
        assert.equal(await group.locator('[data-cheat]').count(), 6);
        assert.equal(await page.locator('[role="dialog"]:visible').count(), 1);
        assert.equal(
            await page.locator('#cheat-dialog, #cheat-mode, #apply-cheats, #cancel-cheats').count(),
            0,
        );
        for (const key of cheatOptionIds) {
            assert.equal(await group.locator(`[data-cheat="${key}"]`).isVisible(), true);
            assert.equal(await group.locator(`[data-cheat="${key}"]`).isChecked(), false);
        }
        await activate('[data-cheat="levelSelection"]');
        assert.equal(await page.locator('#cheat-navigation').isVisible(), true);
        assert.equal(
            await page.evaluate(
                () => JSON.parse(localStorage.getItem('exolon-cheats')!).levelSelection,
            ),
            true,
            'Changing a checkbox persists before Settings closes',
        );
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        assert.equal(await page.locator('#cheat-navigation').isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-toggle');
        await openSettings(page);
        assert.equal(await page.locator('[data-cheat="levelSelection"]').isChecked(), true);
        await closeSettings(page);
        for (const key of cheatOptionIds) {
            await choose({ [key]: true });
            await reloadGame(page);
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            assert.equal(
                await page.locator(`[data-cheat="${key}"]`).isChecked(),
                true,
                `${key} survives a reload`,
            );
            const saved = await page.evaluate(() =>
                JSON.parse(localStorage.getItem('exolon-cheats')!),
            );
            assert.deepEqual(
                saved,
                Object.fromEntries(cheatOptionIds.map((field) => [field, field === key])),
            );
            assert.equal(
                await page.locator('#cheat-navigation').isVisible(),
                key === 'levelSelection',
            );
            await openSettings(page);
            for (const field of cheatOptionIds)
                assert.equal(
                    await page.locator(`[data-cheat="${field}"]`).isChecked(),
                    field === key,
                );
            await closeSettings(page);
        }
        await choose({ infiniteAmmo: true });
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await activate('#new-game');
        await waitForPlaying(page);
        await page.keyboard.down('Space');
        try {
            await page.waitForFunction(
                () => (document.getElementById('grenades') as HTMLElement).textContent! === '09',
            );
        } finally {
            await page.keyboard.up('Space');
        }
        assert.equal((await page.locator('#ammo').textContent())!, '99');
        await openSettings(page);
        assert.equal((await page.locator('#pause').textContent())!, 'Resume');
        await page.locator('#settings-dismiss').focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await page
                .locator('#settings-close')
                .evaluate((element: HTMLElement) => element === document.activeElement),
            true,
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
            await page
                .locator('#settings-dismiss')
                .evaluate((element: HTMLElement) => element === document.activeElement),
            true,
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#settings-panel').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'game');
        assert.equal((await page.locator('#pause').textContent())!, 'Pause');
        assert.equal(await overlayOpen(page), false);
        await page.keyboard.press('Pause');
        await choose({ levelSelection: true });
        assert.equal((await page.locator('#pause').textContent())!, 'Resume');
        await activate('#next-screen');
        assert.equal((await page.locator('#sector').textContent())!, '002 / 125');
        await activate('#menu');
        await choose(false);
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-cheat]:checked').count(), 0);
        assert.equal(await page.locator('#cheat-navigation').isVisible(), false);
        await page.setViewportSize({ width: 320, height: 600 });
        await closeSettings(page);
        await activate('#fullscreen');
        await page.waitForFunction(
            () => !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await openSettings(page);
        const fits = await dialog.evaluate((element: HTMLElement) => {
            const rect = element.querySelector('.modal-card')!.getBoundingClientRect();
            return (
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                rect.top >= 0 &&
                rect.bottom <= innerHeight
            );
        });
        assert.equal(fits, true);
        await page.screenshot({
            path: `/tmp/exolon-cheat-settings-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await closeSettings(page);
        console.log(
            `PASS: ${name} six immediate persisted independent cheat options inside Settings, Escape/focus trap, restored infinite ammunition, pause restoration, level buttons and mobile Fullscreen modal.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-cheat-settings-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
    for (const raw of [
        'broken json',
        'true',
        '[]',
        '{"infiniteAmmo":"true","invulnerable":1}',
        '{"infiniteAmmo":true,"levelSelection":true,"unknown":true}',
        'blocked',
    ]) {
        const safe = await session.newPage({ hasTouch: touch });
        await prepare(safe);
        const activateSafe = (selector: string) => activateGameControl(safe, selector, touch);
        await safe.addInitScript((raw) => {
            if (raw === 'blocked')
                Storage.prototype.getItem = Storage.prototype.setItem = () => {
                    throw Error('Storage disabled');
                };
            else localStorage.setItem('exolon-cheats', raw);
        }, raw);
        try {
            await openGame(safe, 'http://127.0.0.1:8091/');
            await safe.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            const partial = raw.includes('"infiniteAmmo":true');
            assert.equal(await safe.locator('[data-cheat]:checked').count(), partial ? 2 : 0);
            assert.equal(await safe.locator('#cheat-navigation').isVisible(), partial);
            await openSettings(safe);
            for (const key of cheatOptionIds) {
                assert.equal(
                    await safe.locator(`[data-cheat="${key}"]`).isChecked(),
                    partial && ['infiniteAmmo', 'levelSelection'].includes(key),
                );
            }
            await closeSettings(safe);
            if (raw === 'blocked') {
                await chooseCheats(safe, { infiniteAmmo: true, levelSelection: true }, touch);
                assert.equal(await safe.locator('#cheat-navigation').isVisible(), true);
                await openSettings(safe);
                assert.equal(await safe.locator('[data-cheat="infiniteAmmo"]').isChecked(), true);
                await closeSettings(safe);
                await activateSafe('#new-game');
                await waitForPlaying(safe);
                await fireUntil(safe, 'grenades', '09');
                assert.equal(
                    (await safe.locator('#ammo').textContent())!,
                    '99',
                    'Blocked storage must not prevent active cheats',
                );
            }
        } finally {
            await safe.close();
        }
    }
    assert.deepEqual(errors, []);
    console.log(
        `PASS: ${name} malformed/primitive/nonboolean settings ignored, partial saved options restored and blocked storage remains playable.`,
    );
}
async function checkCheatMode(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1100 },
        hasTouch: touch,
    });
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    const choose = (options: boolean | Partial<Cheats>) => chooseCheats(page, options, touch);
    await prepare(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-cheat]:checked').count(), 0);
        assert.equal(await page.locator('#cheat-navigation').isVisible(), false);
        for (const id of ['pause', 'restart', 'menu'])
            assert.equal(
                await page.locator(`#${id}`).evaluate((element) => (element as HTMLElement).hidden),
                true,
                'Gameplay buttons stay hidden in the title menu',
            );
        await openSettings(page);
        for (const key of cheatOptionIds) {
            const field = page.locator(`[data-cheat="${key}"]`);
            if (touch) await field.tap();
            else await field.check();
        }
        await closeSettings(page);
        assert.equal(await page.locator('[data-cheat]:checked').count(), 6);
        assert.equal(
            await page
                .locator('#title-screen')
                .evaluate((element) => (element as HTMLElement).hidden),
            false,
        );
        assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
        assert.equal(await page.locator('#cheat-navigation').isVisible(), true);
        assert.equal(await page.locator('#previous-screen').isDisabled(), true);
        await expectMusic(page, `${name} cheat menu`);
        const loops = await page.evaluate(() => window.__exolonAudioSnapshot().loops);
        await activate('#next-screen');
        assert.equal((await page.locator('#cheat-screen').textContent())!, 'SCREEN 002 / 125');
        assert.equal(await page.evaluate(() => window.__exolonAudioSnapshot().loops), loops);
        await activate('#new-game');
        await waitForPlaying(page);
        assert.equal((await page.locator('#sector').textContent())!, '002 / 125');
        await openHome(page);
        for (const id of ['pause', 'restart', 'menu'])
            assert.equal(
                await page.locator(`#${id}`).isVisible(),
                true,
                'Gameplay buttons appear after Start in Home',
            );
        await closeHome(page);
        await activate('#previous-screen');
        assert.equal((await page.locator('#sector').textContent())!, '001 / 125');
        await page.keyboard.down('Space');
        try {
            await page.waitForFunction(
                () => Number((document.getElementById('score') as HTMLElement).textContent!) > 0,
            );
        } finally {
            await page.keyboard.up('Space');
        }
        await activate('#pause');
        const supplies = await page.evaluate(() =>
            ['score', 'lives', 'ammo', 'grenades'].map(
                (id) => (document.getElementById(id) as HTMLElement).textContent!,
            ),
        );
        assert.deepEqual(
            supplies.slice(2),
            ['99', '10'],
            'CHEAT MODE never consumes bullets or rockets',
        );
        await activate('#next-screen');
        assert.equal(await overlayOpen(page), true);
        assert.equal(await page.locator('#overlay-title').isVisible(), false);
        assert.equal(await page.locator('#overlay-copy').isVisible(), false);
        assert.equal(
            await page.locator('#pause').evaluate((element) => (element as HTMLElement).hidden),
            false,
        );
        assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(
            await page.evaluate(() =>
                ['score', 'lives', 'ammo', 'grenades'].map(
                    (id) => (document.getElementById(id) as HTMLElement).textContent!,
                ),
            ),
            supplies,
        );
        await page.evaluate(() => {
            for (let i = 0; i < 24; i++)
                (document.getElementById('next-screen') as HTMLButtonElement).click();
        });
        assert.equal((await page.locator('#sector').textContent())!, '026 / 125');
        assert.match((await page.locator('#stage-label').textContent())!, /^02 \/ STAGE/);
        await page.evaluate(() => {
            for (let i = 0; i < 110; i++)
                (document.getElementById('next-screen') as HTMLButtonElement).click();
        });
        assert.equal((await page.locator('#sector').textContent())!, '125 / 125');
        assert.equal(await page.locator('#next-screen').isDisabled(), true);
        await page.setViewportSize({ width: 320, height: 900 });
        const fits = await page.locator('#cheat-navigation').evaluate((element: HTMLElement) => {
            const r = element.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
        });
        assert.equal(fits, true);
        await page.screenshot({
            path: `/tmp/exolon-cheat-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#menu');
        for (const id of ['pause', 'restart', 'menu'])
            assert.equal(
                await page.locator(`#${id}`).evaluate((element) => (element as HTMLElement).hidden),
                true,
                'Returning to the title hides gameplay buttons again',
            );
        await activate('#show-scores');
        assert.equal((await page.locator('#scores-best').textContent())!, supplies[0]);
        assert.equal(
            await page.evaluate(() => localStorage.getItem('exolon-best-score')),
            String(Number(supplies[0])),
        );
        await activate('#back-title');
        await choose(false);
        assert.equal(await page.locator('#cheat-navigation').isVisible(), false);
        await activate('#new-game');
        await waitForPlaying(page);
        assert.equal((await page.locator('#sector').textContent())!, '001 / 125');
        await activate('#menu');
        await choose(true);
        assert.equal((await page.locator('#cheat-screen').textContent())!, 'SCREEN 001 / 125');
        await activate('#new-game');
        await waitForPlaying(page);
        assert.equal(
            (await page.locator('#sector').textContent())!,
            '001 / 125',
            'Re-enabling cheats starts the screen displayed in the menu',
        );
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-cheat]:checked').count(), 6);
        assert.equal(await page.locator('#cheat-navigation').isVisible(), true);
        console.log(
            `PASS: ${name} CHEAT MODE toggle, menu/playing/paused selection, all125bounds, stage crossing, supplies, local personal best, persistence, music and320px.`,
        );
    } finally {
        await page.close();
    }
}
async function checkHitHaptics(session: Browser, name: string) {
    const page = await session.newPage();
    await prepare(page);
    await virtualGamepads(page);
    // Control the data boundary so both projectiles have a guaranteed physical target.
    // Collision detection, simulation ticks, input and event delivery remain production code.
    await page.route('**/data/world.json*', async (route) => {
        const response = await route.fetch(),
            world = await response.json(),
            first = world.screens[0];
        first.tiles = Array.from({ length: 768 }, (_, index) =>
            index >= 576
                ? { ...(first.tiles[index] || { shape: 0, color: 0 }), collision: 1, block: 33 }
                : null,
        );
        first.objects = [{ id: 15, type: 17, x: 15, y: 0, instance: 999 }];
        first.actions = [];
        first.placements = [];
        world.enemies = [];
        await route.fulfill({ json: world });
    });
    await page.addInitScript(() => {
        window.__hitRumble = [];
        window.__exolonVirtualPad.vibrationActuator = {
            effects: ['dual-rumble'],
            playEffect(type, params) {
                window.__hitRumble.push({ type, ...params });
                return Promise.resolve('complete');
            },
            reset() {
                window.__hitRumble.push({ type: 'reset' });
                return Promise.resolve('complete');
            },
        };
    });
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await chooseCheats(page, true);
        await activateGameControl(page, '#new-game');
        await waitForPlaying(page);
        await padFrames(page);
        assert.equal(
            await page.evaluate(() => window.__hitRumble.length),
            0,
            'No vibration before a real impact',
        );
        await padButton(page, 2, true);
        await page.waitForFunction(() =>
            window.__hitRumble.some((effect) => effect.duration === 55),
        );
        await page.waitForFunction(() =>
            window.__hitRumble.some((effect) => effect.duration === 140),
        );
        await padButton(page, 2, false);
        await activateControl(page.locator('#pause'));
        const effects = await page.evaluate(() => window.__hitRumble);
        const bullet = effects.find((effect) => effect.duration === 55),
            rocket = effects.find((effect) => effect.duration === 140);
        assert.equal(bullet!.type, 'dual-rumble');
        assert.equal(rocket!.type, 'dual-rumble');
        assert.ok(
            bullet!.weakMagnitude! < rocket!.weakMagnitude! &&
                bullet!.strongMagnitude! < rocket!.strongMagnitude!,
        );
        assert.equal(effects.at(-1)!.type, 'reset', 'Pause stops the selected motor');
        assert.equal(await overlayOpen(page), true);
        await activateControl(page.locator('#pause'));
        await padFrames(page);
        await page.evaluate(() => {
            window.__exolonVirtualPad.vibrationActuator!.playEffect = () =>
                Promise.reject(new DOMException('Rumble denied', 'NotSupportedError'));
        });
        const previousEffects = await page.evaluate(() => window.__exolonAudioSnapshot().effects);
        await padButton(page, 2, true);
        await page.waitForFunction(
            (before) => window.__exolonAudioSnapshot().effects > before,
            previousEffects,
        );
        assert.equal(
            (await page.locator('#ammo').textContent())!,
            '99',
            'Cheat shot still plays without consuming ammunition',
        );
        await padFrames(page, 50);
        await padButton(page, 2, false);
        assert.equal(await overlayOpen(page), false, 'Rejected haptics cannot pause gameplay');
        console.log(
            `PASS: ${name} real bullet/rocket collisions drive weak/medium selected-controller rumble, no start vibration, pause reset and rejected hardware fallback.`,
        );
    } catch (error) {
        console.log(
            await page.evaluate(() => ({
                rumble: window.__hitRumble,
                ammo: (document.getElementById('ammo') as HTMLElement).textContent!,
                grenades: (document.getElementById('grenades') as HTMLElement).textContent!,
                score: (document.getElementById('score') as HTMLElement).textContent!,
                status: (document.getElementById('mission-status') as HTMLElement).textContent!,
                pad: (document.getElementById('notifications') as HTMLElement).textContent!,
            })),
        );
        throw error;
    } finally {
        await page.close();
    }
}
async function checkFullscreen(session: Browser, name: string) {
    const page = await session.newPage({
        viewport: { width: 1100, height: 900 },
        userAgent: MOBILE_USER_AGENT,
    });
    await prepare(page);
    try {
        await page.goto('http://127.0.0.1:8091/');
        await page.locator('[data-platform=retro][aria-disabled=false]').waitFor();
        assert.equal(await page.locator('#platform-picker').isVisible(), true);
        assert.equal(await page.locator('#fullscreen').isVisible(), true);
        assert.equal(await page.locator('#fullscreen').count(), 1);
        await page.locator('#fullscreen').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                document.getElementById('fullscreen')?.getAttribute('aria-pressed') === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        assert.equal(await page.locator('#platform-picker').isVisible(), true);
        await enterGame(page);
        assert.equal(
            await page.locator('#fullscreen').getAttribute('aria-pressed'),
            'true',
            'The classic application inherits fullscreen from the platform picker',
        );
        await page.locator('#fullscreen').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                document.getElementById('fullscreen')?.getAttribute('aria-pressed') === 'false' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        const placement = await page.locator('#fullscreen').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                position: getComputedStyle(element).position,
                top: rect.top,
                right: innerWidth - rect.right,
                inFooter: Boolean(element.closest('.game-footer')),
                inViewport: Boolean(element.closest('.game-viewport')),
            };
        });
        assert.equal(placement.position, 'fixed');
        assert.equal(placement.inFooter, false);
        assert.equal(placement.inViewport, false);
        assert.ok(placement.top >= 8 && placement.top <= 20);
        assert.ok(placement.right >= 8 && placement.right <= 20);
        await page.locator('#settings-toggle').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#settings-panel').isVisible(), false);
        assert.equal(await page.locator('#fullscreen').isVisible(), true);
        await page.locator('#settings-toggle').focus();
        await page.keyboard.press('Enter');
        assert.equal((await page.locator('#fullscreen').textContent())!.trim(), '');
        assert.equal((await page.locator('#fullscreen').getAttribute('aria-label'))!, 'Fullscreen');
        assert.equal(await page.locator('#fullscreen svg').isVisible(), true);
        assert.ok((await page.locator('#fullscreen').boundingBox())!.width <= 44);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        const native = await page.evaluate(() =>
            Boolean(document.fullscreenElement || document.webkitFullscreenElement),
        );
        assert.equal(
            (await page.locator('#fullscreen').getAttribute('aria-label'))!,
            'Exit fullscreen',
        );
        assert.equal(await page.locator('.fullscreen-button__exit').isVisible(), true);
        assert.equal(await page.locator('.fullscreen-button__enter').isVisible(), false);
        await openHome(page);
        assert.equal(await page.locator('#new-game').isVisible(), true);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'false',
        );
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        assert.equal(await page.evaluate(() => document.activeElement!.id), 'game');
        await fireUntil(page, 'ammo', '98');
        const fits = await page.locator('#fullscreen').evaluate((element: HTMLElement) => {
            const r = element.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        });
        assert.equal(fits, true);
        await page.screenshot({
            path: `/tmp/fullscreen-active-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await page.keyboard.press('Escape');
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'false',
        );
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await page.evaluate(() => {
            Element.prototype.requestFullscreen = () =>
                Promise.reject(new DOMException('Denied', 'NotAllowedError'));
            Element.prototype.webkitRequestFullscreen = undefined;
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#fullscreen').click();
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        const mobile = await page.locator('#touch').evaluate((element: HTMLElement) => {
            const r = element.getBoundingClientRect();
            return r.height > 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        });
        assert.equal(mobile, true);
        await page.screenshot({
            path: `/tmp/fullscreen-active-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await page.keyboard.press('Escape');
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'false',
        );
        console.log(
            `PASS: ${name} page-corner Fullscreen on picker and outside settings, ${native ? 'native' : 'window'} entry/exit, in-game keyboard focus, Escape, rejected API fallback and visible mobile controls.`,
        );
    } finally {
        await page.close();
    }
}
async function checkNameEntry(session: Browser, name: string) {
    for (const variant of [
        'normal',
        'legacy',
        'higher-best',
        'cheat',
        'cheat-game-over',
        'blocked',
        'gamepad',
    ]) {
        const normal = variant === 'normal' || variant === 'legacy';
        const cheated = variant === 'cheat' || variant === 'cheat-game-over';
        const expectedScore = variant === 'cheat-game-over' ? 5000 : 19000;
        const touch = name === 'WebKit';
        const page = await session.newPage({
            viewport: { width: 1100, height: 1000 },
            hasTouch: touch,
        });
        await prepare(page);
        const activate = (selector: string) => activateGameControl(page, selector, touch);
        if (variant === 'legacy')
            await page.addInitScript(() => {
                delete (String.prototype as { normalize?: string['normalize'] }).normalize;
            });
        if (variant === 'gamepad') await virtualGamepads(page);
        if (variant === 'higher-best')
            await page.addInitScript(() => {
                localStorage.setItem('exolon-best-score', '99000');
                localStorage.setItem(
                    'exolon-player-record',
                    JSON.stringify({ score: 99000, name: 'VETERAN', playerName: 'OLD' }),
                );
            });
        if (variant === 'blocked')
            await page.addInitScript(() => {
                Storage.prototype.getItem = () => {
                    throw new DOMException('Blocked', 'SecurityError');
                };
                Storage.prototype.setItem = () => {
                    throw new DOMException('Blocked', 'SecurityError');
                };
            });
        if (variant === 'cheat-game-over')
            await page.route('**/clock.js{,?v=*}', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: "import {createClock as original} from './clock.js?original';export function createClock(tick,interval){const clock=original(tick,interval/8),setInterval=clock.setInterval;clock.setInterval=(next)=>setInterval.call(clock,next/8);return clock;}",
                }),
            );
        // Controlled final exit at the map-data boundary; the actual model produces victory.
        await page.route('**/data/world.json*', async (route) => {
            const response = await route.fetch(),
                world = await response.json(),
                last = world.screens[124];
            last.tiles = Array.from({ length: 768 }, (_, index) =>
                index >= 576
                    ? { ...(last.tiles[index] || { shape: 0, color: 0 }), collision: 1, block: 33 }
                    : null,
            );
            last.objects =
                variant === 'cheat-game-over'
                    ? [
                          ...Array.from({ length: 5 }, (_, index) => ({
                              id: 9000 + index,
                              type: 14,
                              x: 2,
                              y: 14,
                          })),
                          { id: 9010, type: 17, x: 3, y: 2 },
                      ]
                    : [{ id: 1, type: 16, x: 2, y: 14 }];
            last.actions = [];
            last.placements = [];
            world.enemies = world.enemies.filter(
                (enemy: { screen: number }) => enemy.screen !== 124,
            );
            await route.fulfill({ json: world });
        });
        try {
            await openGame(
                page,
                `http://127.0.0.1:8091/?debug=1&screen=124${variant === 'legacy' ? '&legacy=1' : ''}`,
            );
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            if (cheated)
                await chooseCheats(
                    page,
                    variant === 'cheat' ? true : { infiniteAmmo: true },
                    touch,
                );
            await activate('#new-game');
            await waitForPlaying(page);
            if (variant !== 'cheat-game-over') await page.keyboard.down('ArrowRight');
            await page.locator('#name-entry:not([hidden])').waitFor();
            if (variant !== 'cheat-game-over') await page.keyboard.up('ArrowRight');
            assert.equal(
                await page.locator('#name-hint').textContent(),
                'Up to 8 letters or digits. Remastered supports international letters. Enter — save.',
                'Every qualifying local score offers the same name entry without a cheat warning',
            );
            assert.equal(await page.evaluate(() => document.activeElement!.id), 'player-name');
            assert.equal(
                await page.locator('#player-name').inputValue(),
                '',
                'Name entry starts empty, including when a previous player name is stored',
            );
            await page.keyboard.type('A');
            assert.equal(await page.locator('#player-name').inputValue(), 'A');
            await page.keyboard.press('Backspace');
            assert.equal(await page.locator('#player-name').inputValue(), '');
            const hiddenForm = await page
                .locator('#name-entry')
                .evaluate((element: HTMLElement) => {
                    const r = element.getBoundingClientRect();
                    return (
                        r.width <= 1 &&
                        r.height <= 1 &&
                        getComputedStyle(element).clipPath === 'inset(50%)'
                    );
                });
            assert.equal(
                hiddenForm,
                true,
                'The name field and form have no visible UI below the game',
            );
            await openSettings(page);
            await page.locator('#volume').focus();
            await activate('#game');
            assert.equal(
                await page.evaluate(() => document.activeElement!.id),
                'player-name',
                'Tapping the game focuses the keyboard input',
            );
            assert.equal(await page.locator('#start').count(), 0);
            assert.equal((await page.locator('#player-name').getAttribute('maxlength'))!, '8');
            if (normal) {
                await page.locator('#player-name').fill('ЖУК');
                await page.keyboard.press('Enter');
                assert.equal(await page.locator('#name-entry').isVisible(), true);
                assert.equal(
                    await page
                        .locator('#player-name')
                        .evaluate((element: HTMLInputElement) => element.validity.valid),
                    false,
                );
                await page.locator('#player-name').fill('');
                await page.keyboard.type('ABCDEFGHI');
                assert.equal(await page.locator('#player-name').inputValue(), 'ABCDEFGH');
            }
            await page.locator('#player-name').fill('');
            await page.keyboard.type('ace-7!x');
            await page.keyboard.press('Backspace');
            await padFrames(page);
            const originalPixels = await page.evaluate(async () => {
                const graphics = await (
                    await fetch(
                        new URL('./assets/graphics/zx-spectrum/graphics.json', document.baseURI),
                    )
                ).json();
                const image = (document.getElementById('game') as HTMLCanvasElement)
                    .getContext('2d')!
                    .getImageData(96, 120, 64, 8).data;
                const text = 'ACE-7!--';
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 64; x++) {
                        const glyph = text.charCodeAt(x >> 3) - 32,
                            bit = (graphics.font[glyph * 8 + y] >> (7 - (x & 7))) & 1;
                        if (image[(y * 64 + x) * 4] !== bit * 255) return false;
                    }
                return true;
            });
            assert.equal(
                originalPixels,
                true,
                'Typed name appears in the original Hall of Fame pixel slot',
            );
            if (normal) {
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption('remastered');
                await closeSettings(page);
                await padFrames(page);
                assert.equal(await page.locator('#player-name').inputValue(), 'ace-7!');
                await activate('#game');
                assert.equal(await page.evaluate(() => document.activeElement!.id), 'player-name');
                await page.screenshot({
                    path: `/tmp/exolon-remastered-name-${name.toLowerCase()}.png`,
                    fullPage: true,
                });
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption('retro');
                await closeSettings(page);
                await padFrames(page);
                assert.equal(await page.locator('#player-name').inputValue(), 'ace-7!');
                await page.screenshot({
                    path: `/tmp/exolon-name-${name.toLowerCase()}.png`,
                    fullPage: true,
                });
                await page.setViewportSize({ width: 844, height: 390 });
                await activate('#fullscreen');
                await page.waitForFunction(
                    () =>
                        (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                            'aria-pressed',
                        ) === 'true' &&
                        !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                await activate('#game');
                assert.equal(
                    await page.evaluate(() => document.activeElement!.id),
                    'player-name',
                    'The in-game name remains editable in landscape fullscreen',
                );
                await page.screenshot({
                    path: `/tmp/exolon-name-landscape-${name.toLowerCase()}.png`,
                    fullPage: true,
                });
                await page.locator('#player-name').focus();
            }
            if (variant === 'gamepad') {
                await padFrames(page);
                await padButton(page, 0, true);
            } else await page.keyboard.press('Enter');
            await page.locator('#high-scores:not([hidden])').waitFor({ state: 'attached' });
            const first = (await page.locator('#score-list li').first().textContent())!;
            if (variant === 'higher-best') assert.ok(first.startsWith('VETERAN099000'));
            else assert.ok(first.startsWith(`ACE-7!${String(expectedScore).padStart(6, '0')}`));
            if (cheated)
                assert.equal(
                    (await page.locator('#scores-best').textContent())!,
                    String(expectedScore).padStart(6, '0'),
                );
            if (variant !== 'blocked') {
                const table = await page.evaluate(() =>
                    JSON.parse(localStorage.getItem('exolon-high-scores')!),
                );
                assert.equal(table.length, 50, 'The entire leaderboard is stored as an array');
                if (variant === 'higher-best')
                    assert.deepEqual(
                        table.slice(0, 2).map((row: HighScoreRow) => [row.name, row.score]),
                        [
                            ['VETERAN', 99000],
                            ['ACE-7!', 19000],
                        ],
                    );
                if (cheated)
                    assert.deepEqual(table[0], {
                        name: 'ACE-7!',
                        score: expectedScore,
                        player: true,
                    });
            }
            if (normal) {
                const stored = await page.evaluate(() =>
                    JSON.parse(localStorage.getItem('exolon-player-record')!),
                );
                assert.deepEqual(stored, { score: 19000, name: 'ACE-7!', playerName: 'ACE-7!' });
                await reloadGame(page);
                await page.locator('#show-scores:not([disabled])').waitFor({ state: 'attached' });
                await activate('#show-scores');
                assert.ok(
                    (await page.locator('#score-list li').first().textContent())!.startsWith(
                        'ACE-7!019000',
                    ),
                );
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption('remastered');
                for (const nickname of ['жук', 'Élodie', '王小明']) {
                    await openSettings(page);
                    await activate('#new-game');
                    await waitForPlaying(page);
                    await page.keyboard.down('ArrowRight');
                    await page.locator('#name-entry:not([hidden])').waitFor();
                    await page.keyboard.up('ArrowRight');
                    assert.equal(await page.locator('#player-name').inputValue(), '');
                    await page.keyboard.insertText(nickname);
                    await padFrames(page);
                    assert.equal(await page.locator('#player-name').inputValue(), nickname);
                    if (nickname === 'жук')
                        await page.screenshot({
                            path: `/tmp/exolon-international-name-${name.toLowerCase()}-${variant}.png`,
                            fullPage: true,
                        });
                    await page.keyboard.press('Enter');
                    await page.locator('#high-scores:not([hidden])').waitFor({ state: 'attached' });
                }
                const savedTable = await page.evaluate(() =>
                    JSON.parse(localStorage.getItem('exolon-high-scores')!),
                );
                assert.equal(savedTable.length, 50);
                assert.deepEqual(
                    savedTable.slice(0, 4).map((row: HighScoreRow) => [row.name, row.score]),
                    [
                        ['ACE-7!', 19000],
                        ['ЖУК', 19000],
                        ['ÉLODIE', 19000],
                        ['王小明', 19000],
                    ],
                );
                await page.evaluate(() => {
                    localStorage.removeItem('exolon-best-score');
                    localStorage.removeItem('exolon-player-record');
                });
                await reloadGame(page);
                await page.locator('#show-scores:not([disabled])').waitFor({ state: 'attached' });
                await activate('#show-scores');
                assert.equal(
                    (await page.locator('#scores-best').textContent())!,
                    '019000',
                    'The full table restores the best without legacy keys',
                );
                assert.deepEqual(
                    await page.evaluate(() =>
                        JSON.parse(localStorage.getItem('exolon-high-scores')!),
                    ),
                    savedTable,
                );
                assert.deepEqual(
                    await page.locator('#score-list li').allTextContents(),
                    savedTable.map(
                        (row: HighScoreRow) => row.name + String(row.score).padStart(6, '0'),
                    ),
                );
            }
        } catch (error) {
            console.error(
                `${name} name entry variant=${variant}`,
                await page.evaluate(() => ({
                    game: { ...document.getElementById('game')?.dataset },
                    score: document.getElementById('score')?.textContent,
                    lives: document.getElementById('lives')?.textContent,
                    status: document.getElementById('mission-status')?.textContent,
                    overlay: document.getElementById('overlay-title')?.textContent,
                    nameHidden: document.getElementById('name-entry')?.hidden,
                    settingsHidden: document.getElementById('settings-panel')?.hidden,
                    focus: document.activeElement?.id,
                    documentHidden: document.hidden,
                    hasFocus: document.hasFocus(),
                })),
            );
            throw error;
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} real final victory/name focus, original-font live pixels, Enter, international Remastered names in modern/legacy builds, stored/reloaded names, stronger old record, cheated victory/Game Over local rankings and blocked storage.`,
    );
}
async function checkNavigation(session: Browser, name: string) {
    const page = await session.newPage();
    await prepare(page);
    let phase = 'windowed';
    await page.addInitScript(() => {
        window.__navigationEvents = [];
        for (const type of ['fullscreenchange', 'webkitfullscreenchange', 'keydown'])
            document.addEventListener(
                type,
                (event) => {
                    if (type === 'keydown' && (event as KeyboardEvent).code !== 'Escape') return;
                    window.__navigationEvents.push({
                        type,
                        code: (event as KeyboardEvent).code,
                        native: Boolean(
                            document.fullscreenElement || document.webkitFullscreenElement,
                        ),
                        focus: document.hasFocus(),
                        status: (document.getElementById('mission-status') as HTMLElement)
                            ?.textContent,
                    });
                },
                { capture: true },
            );
    });
    try {
        await begin(page);
        await activateControl(page.locator('#pause'));
        assert.equal(await overlayOpen(page), true);
        await activateControl(page.locator('#pause'));
        assert.equal(await overlayOpen(page), false);
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        assert.equal(await page.locator('#pause').isVisible(), false);
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await page.keyboard.press('Pause');
        assert.equal(await overlayOpen(page), true);
        await openHome(page);
        await page.locator('#pause').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#home-panel').isVisible(), false);
        assert.equal(await overlayOpen(page), true);
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await openHome(page);
        await page.locator('#show-scores').click();
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-intro'), true);
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await openSettings(page);
        await page.locator('#volume').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#settings-panel').isVisible(), false);
        assert.equal(await overlayOpen(page), false);
        await page.keyboard.press('Escape');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        for (const fallback of [false, true]) {
            phase = fallback ? 'fallback-fullscreen' : 'native-fullscreen';
            if (fallback)
                await page.evaluate(() => {
                    Element.prototype.requestFullscreen = () =>
                        Promise.reject(new DOMException('Denied', 'NotAllowedError'));
                });
            await openHome(page);
            await page.locator('#new-game').click();
            await waitForPlaying(page);
            await page.locator('#fullscreen').click();
            await page.waitForFunction(
                () =>
                    (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                        'aria-pressed',
                    ) === 'true' &&
                    !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
            );
            await page.keyboard.press('Escape');
            await page.waitForFunction(
                () =>
                    !(document.getElementById('title-screen') as HTMLElement).hidden &&
                    (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                        'aria-pressed',
                    ) === 'false',
            );
        }
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await page.locator('#fullscreen').click();
        await page.waitForFunction(
            () => !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await page.locator('#fullscreen').click();
        assert.equal(
            await menuPresented(page, 'title-screen'),
            false,
            'The fullscreen exit button preserves the game',
        );
        console.log(
            `PASS: ${name} Escape returns to title from game/pause/buttons/inputs/scores/native and window fullscreen; dedicated pause button/Pause key and fullscreen exit remain separate.`,
        );
    } catch (error) {
        console.log(
            name,
            phase,
            await page.evaluate(() => ({
                events: window.__navigationEvents,
                title: (document.getElementById('title-screen') as HTMLElement).hidden,
                native: Boolean(document.fullscreenElement || document.webkitFullscreenElement),
                status: (document.getElementById('mission-status') as HTMLElement).textContent!,
                focus: document.hasFocus(),
            })),
        );
        throw error;
    } finally {
        await page.close();
    }
}
async function checkFooter(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: touch,
        userAgent: MOBILE_USER_AGENT,
    });
    await prepare(page);
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    const choose = (options: boolean | Partial<Cheats>) => chooseCheats(page, options, touch);
    async function verify() {
        const layout = await page.evaluate(() => {
            const footer = document.querySelector('footer.game-footer')!,
                area = document.querySelector('.game-viewport')!;
            if (!footer) return { footer: false };
            const walker = document.createTreeWalker(
                document.querySelector('.game-app')!,
                NodeFilter.SHOW_TEXT,
            );
            let node,
                outsideText = 0;
            while ((node = walker.nextNode()))
                if (node.textContent!.trim() && !footer.contains(node)) {
                    let visible = true;
                    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                        const rect = parent.getBoundingClientRect();
                        if (parent.hidden || rect.width <= 1 || rect.height <= 1) visible = false;
                    }
                    if (visible) outsideText++;
                }
            return {
                footer: true,
                outsideText,
                controlsOutside: Array.from(
                    document.querySelectorAll('button,input,select,textarea'),
                ).filter(
                    (element) =>
                        !footer.contains(element) &&
                        !['home', 'split-divider', 'settings-toggle', 'fullscreen'].includes(
                            element.id,
                        ),
                ).length,
                controlsInGame: Array.from(
                    area.querySelectorAll('button,input,select,label,p,h1,h2,span'),
                ).filter(
                    (element) => !element.closest('#split-divider, .settings-toggle, .home-button'),
                ).length,
                below:
                    footer.getBoundingClientRect().top >=
                    (document.getElementById('game') as HTMLCanvasElement).getBoundingClientRect()
                        .bottom -
                        1,
            };
        });
        assert.deepEqual(
            layout,
            { footer: true, outsideText: 0, controlsOutside: 0, controlsInGame: 0, below: true },
            `${name}: game controls stay in the footer with explicit floating controls`,
        );
    }
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await verify();
        await page.screenshot({
            path: `/tmp/exolon-footer-${name.toLowerCase()}-desktop.png`,
            fullPage: true,
        });
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            assert.ok(
                await page.locator('footer.game-footer').evaluate((footer) => {
                    const bounds = footer.getBoundingClientRect();
                    return (
                        document.documentElement.scrollWidth <= innerWidth &&
                        Array.from(footer.querySelectorAll('button,input,select'))
                            .filter((element) => element.getClientRects().length)
                            .every((element) => {
                                const rect = element.getBoundingClientRect();
                                return rect.left >= bounds.left && rect.right <= bounds.right;
                            })
                    );
                }),
                `${name}: footer controls fit at ${width}px`,
            );
            await choose(true);
            await choose(false);
            await page.screenshot({
                path: `/tmp/exolon-footer-${name.toLowerCase()}-${width}.png`,
                fullPage: true,
            });
        }
        await activate('#new-game');
        await waitForPlaying(page);
        await verify();
        const highlightMatches = (pressed: boolean) => {
            const channels = getComputedStyle(document.getElementById('pause') as HTMLButtonElement)
                .backgroundColor.match(/[\d.]+/g)!
                .map(Number);
            return (
                (Math.min(...channels.slice(0, 3)) >= 200 &&
                    (channels.length === 3 || channels[3] > 0.9)) === pressed
            );
        };
        await activate('#pause');
        assert.equal(
            await page
                .getByRole('button', { name: 'Resume', exact: true, includeHidden: true })
                .count(),
            1,
            'Pause has one Continue button',
        );
        assert.equal((await page.locator('#pause').getAttribute('aria-pressed'))!, 'true');
        await page.waitForFunction(highlightMatches, true);
        await verify();
        await activate('#pause');
        assert.equal((await page.locator('#pause').getAttribute('aria-pressed'))!, 'false');
        await page.waitForFunction(highlightMatches, false);
        await page.keyboard.press('Escape');
        await verify();
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                (document.getElementById('fullscreen') as HTMLButtonElement).getAttribute(
                    'aria-pressed',
                ) === 'true' &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await activate('#new-game');
        await waitForPlaying(page);
        await verify();
        const fits = await page.locator('#touch').evaluate((element: HTMLElement) => {
            const rect = element.getBoundingClientRect();
            return rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
        });
        assert.equal(fits, true);
        await page.screenshot({
            path: `/tmp/exolon-footer-fullscreen-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await page.keyboard.press('Escape');
        await verify();
        console.log(
            `PASS: ${name} footer controls plus floating Settings/Fullscreen, Canvas game area, menu/pause/play/Escape, 320/390px and fullscreen touch controls.`,
        );
    } finally {
        await page.close();
    }
}
async function checkTitleFire(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({ viewport: { width: 1000, height: 900 }, hasTouch: touch });
    await prepare(page);
    await virtualGamepads(page);
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await activate('#game');
        await page.waitForFunction(
            () =>
                (document.getElementById('game') as HTMLCanvasElement).dataset.intro === undefined,
        );
        for (const code of ['Space', 'KeyM']) {
            await page.locator('#game').focus();
            await page.keyboard.down(code);
            await page.waitForFunction(
                () => (document.getElementById('title-screen') as HTMLElement).hidden,
                {},
                { timeout: 2000 },
            );
            await waitForPlaying(page);
            await page.keyboard.down(code);
            await padFrames(page, 25);
            assert.equal(
                (await page.locator('#ammo').textContent())!,
                '99',
                'The held start press must not fire',
            );
            assert.equal((await page.locator('#grenades').textContent())!, '10');
            await page.keyboard.up(code);
            await page.keyboard.down(code);
            await page.waitForFunction(
                () => (document.getElementById('ammo') as HTMLElement).textContent! === '98',
            );
            await page.keyboard.up(code);
            assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).active, 0);
            await page.keyboard.press('Escape');
        }
        for (const button of [2, 7]) {
            await padFrames(page);
            await padButton(page, button, true);
            if (button === 7) {
                assert.equal(
                    await page
                        .locator('#title-screen')
                        .evaluate((element) => (element as HTMLElement).hidden),
                    false,
                );
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
                await padButton(page, button, false);
                continue;
            }
            await waitForPlaying(page);
            await padFrames(page, 25);
            assert.equal((await page.locator('#ammo').textContent())!, '99');
            assert.equal((await page.locator('#grenades').textContent())!, '10');
            await padButton(page, button, false);
            await padButton(page, button, true);
            await page.waitForFunction(
                () => (document.getElementById('ammo') as HTMLElement).textContent! === '98',
            );
            await padButton(page, button, false);
            await page.keyboard.press('Escape');
        }
        await openSettings(page);
        await page.locator('#graphics-mode').focus();
        await page.keyboard.press('KeyM');
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await openSettings(page);
        await page.keyboard.press('KeyM');
        await padButton(page, 2, true);
        await padButton(page, 2, false);
        assert.equal(await page.locator('#settings-panel').isVisible(), true);
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await page.keyboard.press('Escape');
        await activate('#show-scores');
        await page.locator('#game').focus();
        await page.keyboard.press('Space');
        await waitForPlaying(page);
        console.log(
            `PASS: ${name} Space/M and gamepad X start from title/records, RT stays reserved for rockets, held-start isolation, release-to-fire, no late menu music and form/modal guards.`,
        );
    } finally {
        await page.close();
    }
}
async function checkRetryLevel(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({ viewport: { width: 1000, height: 900 }, hasTouch: touch });
    await prepare(page);
    await virtualGamepads(page);
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    // Only pacing and map inputs are fixtures. All nine deaths, game over, retries and UI use production code.
    await page.route('**/clock.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: "import {createClock as original} from './clock.js?original';export function createClock(tick,interval){const clock=original(tick,interval/8),setInterval=clock.setInterval;clock.setInterval=(next)=>setInterval.call(clock,next/8);return clock;}",
        }),
    );
    await page.route('**/data/world.json*', async (route) => {
        const response = await route.fetch(),
            world = await response.json();
        world.enemies = [];
        for (const [index, map] of world.screens.entries()) {
            map.tiles = Array.from({ length: 768 }, (_, i) =>
                i >= 576 ? { collision: 1, block: 33, shape: 0, color: 0 } : null,
            );
            map.placements = [];
            map.actions = [];
            map.objects = index === 35 ? [{ id: 1, type: 17, x: 3, y: 2 }] : [];
        }
        await route.fulfill({ json: world });
    });
    const waitOver = () =>
        page.waitForFunction(
            () =>
                (document.getElementById('lives') as HTMLElement).textContent! === '00' &&
                !(document.getElementById('overlay') as HTMLElement).hidden,
            {},
            { timeout: 15000 },
        );
    async function verifyFresh() {
        await waitForPlaying(page);
        await activate('#pause');
        assert.equal((await page.locator('#sector').textContent())!, '036 / 125');
        assert.deepEqual(
            await page.evaluate(() =>
                ['lives', 'ammo', 'grenades', 'score'].map(
                    (id) => (document.getElementById(id) as HTMLElement).textContent!,
                ),
            ),
            ['09', '99', '10', '000000'],
        );
    }
    try {
        await openGame(page, 'http://127.0.0.1:8091/?debug=1&screen=35');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await openSettings(page);
        assert.equal(await page.locator('[data-cheat="retryLevel"]').count(), 1);
        await closeSettings(page);
        await activate('#new-game');
        await waitOver();
        await chooseCheats(page, { retryLevel: true }, touch);
        assert.equal(
            (await page.locator('#pause').textContent())!,
            'Retry screen',
            'A retry option enabled after game over updates the available action',
        );
        for (const button of ['#pause', '#restart']) {
            await activate(button);
            await verifyFresh();
            await activate('#pause');
            await waitOver();
        }
        await padFrames(page);
        await padButton(page, 0, true);
        await padButton(page, 0, false);
        await verifyFresh();
        await activate('#menu');
        assert.equal((await page.locator('#sector').textContent())!, '001 / 125');
        await page.locator('#game').focus();
        await page.keyboard.press('Space');
        await waitForPlaying(page);
        assert.equal(
            (await page.locator('#sector').textContent())!,
            '001 / 125',
            'Menu exit clears the retry checkpoint even under a debug URL',
        );
        await activate('#menu');
        await chooseCheats(page, { retryLevel: true, levelSelection: true }, touch);
        for (let i = 0; i < 5; i++) await activate('#next-screen');
        await activate('#new-game');
        await waitForPlaying(page);
        assert.equal((await page.locator('#sector').textContent())!, '006 / 125');
        await page.keyboard.press('Escape');
        assert.equal((await page.locator('#cheat-screen').textContent())!, 'SCREEN 001 / 125');
        assert.equal(await page.locator('#previous-screen').isDisabled(), true);
        await padFrames(page);
        await padButton(page, 2, true);
        await waitForPlaying(page);
        assert.equal((await page.locator('#sector').textContent())!, '001 / 125');
        await padButton(page, 2, false);
        console.log(
            `PASS: ${name} all-nine-lives game over, retry same screen via buttons/gamepad, fresh resources, menu/Escape reset to screen1 including level selection.`,
        );
    } finally {
        await page.close();
    }
}
if (process.argv.includes('--retry-fire-only')) {
    try {
        await checkTitleFire(browser, 'Chromium');
        await checkRetryLevel(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkTitleFire(session, name);
            await checkRetryLevel(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
async function checkGraphicsModes(session: Browser, name: string) {
    const touch = name === 'WebKit';
    const page = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: touch,
    });
    await prepare(page);
    const activate = (selector: string) => activateGameControl(page, selector, touch);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(
            await page.locator('#graphics-mode').count(),
            1,
            'The footer offers a Retro / Remastered selector',
        );
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'retro');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        await padFrames(page);
        // Cover art has its own 1280px canvas; test the title only after leaving it.
        await page.keyboard.press('Escape');
        await padFrames(page);
        assert.equal(
            await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.width),
            1024,
        );
        await page.screenshot({
            path: `/tmp/exolon-remastered-title-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#show-scores');
        await padFrames(page);
        await page.screenshot({
            path: `/tmp/exolon-remastered-scores-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#new-game');
        await waitForPlaying(page);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        await padFrames(page);
        assert.equal(
            await overlayOpen(page),
            false,
            'Live switching must keep the mission running',
        );
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        await padFrames(page);
        assert.equal(await overlayOpen(page), false);
        await page.keyboard.press('ArrowRight');
        await activate('#pause');
        const supplies = (await page.locator('#hud').textContent())!;
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        await padFrames(page);
        assert.equal(
            await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.width),
            256,
        );
        assert.equal((await page.locator('#hud').textContent())!, supplies);
        assert.equal(
            await page.locator('#pause').evaluate((element) => !(element as HTMLElement).hidden),
            true,
        );
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('remastered');
        await padFrames(page);
        assert.equal((await page.locator('#hud').textContent())!, supplies);
        assert.equal(
            await page.locator('#pause').evaluate((element) => !(element as HTMLElement).hidden),
            true,
        );
        await page.screenshot({
            path: `/tmp/exolon-remastered-game-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        const checked = await page.evaluate(async () => {
            const [{ createRenderer }, { createState, step }, world, graphics] = await Promise.all([
                import(new URL('./view/renderer.js', document.baseURI).href),
                import(new URL('./model/state.js', document.baseURI).href),
                fetch('./data/world.json').then((r) => r.json()),
                fetch('./assets/graphics/zx-spectrum/graphics.json').then((r) => r.json()),
            ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, graphics),
                context = canvas.getContext('2d')!;
            const pixels = () =>
                context.getImageData(0, 0, canvas.width, canvas.height).data.slice();
            const same = (
                a: Uint8Array | Uint8ClampedArray | readonly number[],
                b: ArrayLike<number>,
            ) => a.length === b.length && a.every((v, i) => v === b[i]);
            let state = createState(world);
            state = step(state, { right: true, fire: true }).state;
            renderer.addEvents([], state);
            renderer.render(state, 1000, 0.4);
            const retro = pixels(),
                before = JSON.stringify(state);
            renderer.setGraphicsMode('remastered');
            renderer.render(state, 1000, 0.4);
            if (canvas.width !== 1024 || same(pixels(), retro) || JSON.stringify(state) !== before)
                throw Error('Remaster must redraw without changing model state');
            const colors = new Set(),
                p = pixels();
            for (let i = 0; i < p.length; i += 4) {
                colors.add(`${p[i]},${p[i + 1]},${p[i + 2]}`);
                if (colors.size > 100) break;
            }
            if (colors.size <= 100) throw Error('Remaster has no shaded redrawn artwork');
            const modern = pixels();
            renderer.render(state, 9000, 0.4);
            if (!same(modern, pixels()))
                throw Error('A paused remaster must not advance animation');
            renderer.setGraphicsMode('retro');
            renderer.render(state, 1000, 0.4);
            if (!same(pixels(), retro))
                throw Error('Returning to Retro must restore exact source pixels');
            renderer.setGraphicsMode('remastered');
            for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                const sample = createState(world, { screenIndex }),
                    snapshot = JSON.stringify(sample);
                renderer.addEvents([], sample);
                renderer.render(sample, 0, 0);
                if (JSON.stringify(sample) !== snapshot)
                    throw Error(`Remaster mutated screen ${screenIndex}`);
            }
            const actors = createState(world);
            actors.tick = 20;
            actors.player.x = 32;
            actors.enemies = [1, 16, 20, 24, 37, 41].map((sprite, i) => ({
                sprite,
                x: 40 + i * 12,
                y: 60,
                phase: i & 3,
                color: 66 + i,
                trajectory: [],
                trajectoryIndex: 0,
            }));
            actors.spheres = [{ x: 40, y: 90 }];
            actors.killer = { x: 80, y: 100 };
            actors.bullets = [{ x: 50, y: 120, dx: 1 }];
            actors.enemyBullets = [{ x: 70, y: 112, dx: -1 }];
            actors.grenade = { x: 60, y: 80, dx: 1, phase: 25, projectileId: 1 };
            actors.rockets = [
                { x: 90, y: 100, dx: -1, kind: 'homing', projectileId: 2 },
                { x: 100, y: 80, dx: -2, kind: 'launcher', projectileId: 3 },
            ];
            renderer.addEvents(
                [
                    { type: 'explosion', x: 180, y: 120 },
                    { type: 'object-destroyed', x: 200, y: 100, instance: 2 },
                ],
                actors,
            );
            renderer.render(actors, 0, 0.5);
            for (const kind of ['crouch', 'jump', 'death', 'armor']) {
                const actor = createState(world);
                actor.tick = 30;
                actor.player.duck = kind === 'crouch';
                actor.player.jump = kind === 'jump' ? 3 : -1;
                actor.death = kind === 'death' ? 40 : 0;
                actor.exoskeleton = kind === 'armor';
                renderer.addEvents([], actor);
                renderer.render(actor, 0, 0.5);
            }
            for (const status of ['bonus', 'won', 'over']) {
                const sample = createState(world);
                sample.status = status;
                sample.bonus = { cursor: 3 };
                renderer.render(sample, 1000, 0, {
                    nameEntry: status === 'won',
                    playerName: 'ORBIT',
                });
            }
            renderer.destroy();
            return true;
        });
        assert.equal(checked, true);
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'remastered');
        await page.keyboard.press('Escape');
        await padFrames(page);
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
            );
            await page.screenshot({
                path: `/tmp/exolon-remastered-${name.toLowerCase()}-${width}.png`,
                fullPage: true,
            });
        }
        await activate('#fullscreen');
        await page.waitForFunction(
            () => !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        await padFrames(page);
        assert.equal(await page.locator('#game').evaluate((c: HTMLCanvasElement) => c.width), 256);
        for (const blocked of [false, true]) {
            const safe = await session.newPage();
            await prepare(safe);
            await safe.addInitScript((blocked) => {
                if (blocked)
                    Storage.prototype.getItem = Storage.prototype.setItem = () => {
                        throw Error('Storage disabled');
                    };
                else localStorage.setItem('exolon-graphics', 'unknown');
            }, blocked);
            try {
                await openGame(safe, 'http://127.0.0.1:8091/');
                await safe.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                assert.equal(await safe.locator('#graphics-mode').inputValue(), 'retro');
                await openSettings(safe);
                await safe.locator('#graphics-mode').selectOption('remastered');
                await padFrames(safe);
                await safe.keyboard.press('Escape');
                await padFrames(safe);
                assert.equal(
                    await safe.locator('#game').evaluate((c: HTMLCanvasElement) => c.width),
                    1024,
                );
            } finally {
                await safe.close();
            }
        }
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} live Retro/Remastered switch, exact Retro restoration, redrawn 125 screens, paused state, menus/finale, saved preference and mobile/fullscreen layout.`,
        );
    } finally {
        await page.close();
    }
}
if (
    process.argv.includes('--activity-pause-only') ||
    process.argv.includes('--pause-resume-only')
) {
    const check = process.argv.includes('--pause-resume-only')
        ? checkPauseResume
        : checkActivityPause;
    try {
        await check(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await check(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--settings-panel-only')) {
    try {
        await checkSettingsPanel(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkSettingsPanel(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (
    process.argv.includes('--original-cheats-only') ||
    process.argv.includes('--zx-game-over-only')
) {
    const check = process.argv.includes('--zx-game-over-only')
        ? checkZxGameOver
        : checkOriginalCheats;
    try {
        await check(browser, 'Chromium');
        for (const [engine, name] of [
            [firefox, 'Firefox'],
            [webkit, 'WebKit'],
        ] as const) {
            const session = await engine.launch({ headless: true });
            try {
                await check(session, name);
            } finally {
                await session.close();
            }
        }
    } finally {
        await browser.close();
    }
    process.exit(0);
}
if (process.argv.includes('--control-menu-only')) {
    try {
        await checkControlMenu(browser, 'Chromium');
        for (const [engine, name] of [
            [firefox, 'Firefox'],
            [webkit, 'WebKit'],
        ] as const) {
            const session = await engine.launch({ headless: true });
            try {
                await checkControlMenu(session, name);
            } finally {
                await session.close();
            }
        }
    } finally {
        await browser.close();
    }
    process.exit(0);
}

if (process.argv.includes('--analytics-only')) {
    try {
        await checkAnalytics(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkAnalytics(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--motion-timing-only')) {
    try {
        await checkMotionTiming(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkMotionTiming(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--launch-options-only')) {
    try {
        await checkLaunchOptions(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkLaunchOptions(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--vr-support-only')) {
    try {
        await checkVrSupport(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkVrSupport(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--vr-only')) {
    try {
        if (!process.argv.includes('--webkit-only')) {
            await checkVr(browser, 'Chromium');
            await checkVrImmersive(browser, 'Chromium');
            await checkVrPanels(browser, 'Chromium');
        }
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkVr(session, name);
            await checkVrImmersive(session, name);
            await checkVrPanels(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--seo-only')) {
    try {
        await checkSeo(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkSeo(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
async function checkBundledLoading() {
    for (const [name, engine] of (
        [
            ['Chromium', chromium],
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({
            headless: true,
            ...(name === 'Chromium' ? { args: ['--autoplay-policy=user-gesture-required'] } : {}),
        });
        try {
            await checkLoading(session, name);
        } finally {
            await session.close();
        }
    }
}
if (process.argv.includes('--compressed-music-only')) {
    await browser.close();
    for (const [name, engine] of [
        ['Chromium', chromium],
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkCompressedMusic(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--loading-only')) {
    await browser.close();
    await checkBundledLoading();
    process.exit(0);
}
if (process.argv.includes('--platform-select-only')) {
    try {
        await checkPlatformSelection(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkPlatformSelection(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--devices-only')) {
    try {
        await checkDeviceDetection(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkDeviceDetection(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--game-layout-only')) {
    try {
        await checkGameLayout(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkGameLayout(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--home-only')) {
    try {
        await checkHome(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkHome(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--platform-picker-only')) {
    await browser.close();
    const strictBrowser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=user-gesture-required'],
    });
    try {
        await checkHome(strictBrowser, 'Chromium');
        await checkPlatformPicker(strictBrowser, 'Chromium');
    } finally {
        await strictBrowser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkHome(session, name);
            await checkPlatformPicker(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--ps4-only')) {
    try {
        await checkPs4(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkPs4(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--webos-only')) {
    try {
        await checkWebOs3Startup(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkWebOs3Startup(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--tv-only')) {
    try {
        await checkTv(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkTv(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--ui-controls-only')) {
    try {
        await checkUiControls(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkUiControls(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--preact-only')) {
    try {
        await checkPreact(browser, 'Chromium');
        await checkPreactBonus(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkPreact(session, name);
            await checkPreactBonus(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--rocket-trail-only')) {
    try {
        await checkRocketTrail(browser, 'Chromium');
        for (const [engine, name] of [
            [firefox, 'Firefox'],
            [webkit, 'WebKit'],
        ] as const) {
            const session = await engine.launch({ headless: true });
            try {
                await checkRocketTrail(session, name);
            } finally {
                await session.close();
            }
        }
    } finally {
        await browser.close();
    }
    process.exit(0);
}
if (process.argv.includes('--airborne-only')) {
    try {
        if (!process.argv.includes('--webkit-only'))
            await checkAirborneWeapons(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkAirborneWeapons(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--intro-only')) {
    const helpers = { prepare, waitForPlaying };
    try {
        if (!process.argv.includes('--webkit-only')) await checkIntro(browser, 'Chromium', helpers);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkIntro(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--split-pairs-only') || process.argv.includes('--split-pairs-ui-only')) {
    const helpers = { prepare, padFrames, waitForPlaying, overlayOpen, chooseCheats, expectMusic };
    const uiOnly = process.argv.includes('--split-pairs-ui-only');
    try {
        if (!process.argv.includes('--webkit-only')) {
            if (!uiOnly) await checkSplitPairsRenderer(browser, 'Chromium');
            await checkSplitPairUI(browser, 'Chromium', helpers);
        }
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            if (!uiOnly) await checkSplitPairsRenderer(session, name);
            await checkSplitPairUI(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--start-menu-only')) {
    const helpers = { prepare, padFrames, waitForPlaying };
    try {
        if (!process.argv.includes('--webkit-only'))
            await checkStartMenu(browser, 'Chromium', helpers);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkStartMenu(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--gameboy-only') || process.argv.includes('--gameboy-color-only')) {
    const helpers = { prepare, padFrames, waitForPlaying, overlayOpen };
    const options = { color: process.argv.includes('--gameboy-color-only') };
    try {
        if (!process.argv.includes('--webkit-only'))
            await checkGameBoy(browser, 'Chromium', helpers, options);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkGameBoy(session, name, helpers, options);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--native-pacing-only')) {
    try {
        await checkNativePacing(browser, 'Chromium', { prepare });
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkNativePacing(session, name, { prepare });
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--atari-st-only')) {
    try {
        await checkAtariSt(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkAtariSt(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--amiga-only')) {
    try {
        if (!process.argv.includes('--webkit-only'))
            await checkAmiga(browser, 'Chromium', { prepare });
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkAmiga(session, name, { prepare });
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--sharp-only')) {
    const helpers = { prepare, padFrames, waitForPlaying };
    try {
        await checkSharp(browser, 'Chromium', helpers);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkSharp(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--cpc-only')) {
    const helpers = { prepare, padFrames, waitForPlaying, overlayOpen };
    try {
        if (!process.argv.includes('--webkit-only')) await checkCPC(browser, 'Chromium', helpers);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkCPC(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--c64-only')) {
    const helpers = { prepare, padFrames, waitForPlaying, overlayOpen };
    try {
        if (!process.argv.includes('--webkit-only')) await checkC64(browser, 'Chromium', helpers);
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkC64(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--split-only')) {
    const helpers = { prepare, padFrames, waitForPlaying, overlayOpen, chooseCheats, expectMusic };
    try {
        if (!process.argv.includes('--webkit-only')) {
            await checkSplitRenderer(browser, 'Chromium');
            await checkSplitControl(browser, 'Chromium', helpers);
        }
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkSplitRenderer(session, name);
            await checkSplitControl(session, name, helpers);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--legacy-only')) {
    try {
        await checkLegacy(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkLegacy(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--remastered-cache-only')) {
    try {
        await checkRemasteredCache(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkRemasteredCache(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--machinery-only')) {
    try {
        await checkRemasteredMachinery(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkRemasteredMachinery(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--graphics-modes-only')) {
    try {
        await checkGraphicsModes(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkGraphicsModes(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--cheat-settings-only')) {
    try {
        if (!process.argv.includes('--webkit-only')) await checkCheatSettings(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkCheatSettings(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--footer-only')) {
    try {
        await checkFooter(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkFooter(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--navigation-only')) {
    try {
        await checkNavigation(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkNavigation(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--name-entry-only')) {
    try {
        await checkNameEntry(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkNameEntry(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--fullscreen-only')) {
    try {
        await checkFullscreen(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkFullscreen(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--haptics-only')) {
    try {
        await checkHitHaptics(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkHitHaptics(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--cheat-only')) {
    try {
        await checkCheatMode(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkCheatMode(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--title-tap-only')) {
    try {
        await checkTitleTap(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkTitleTap(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--mobile-only')) {
    try {
        await checkMobile(browser, 'Chromium', {
            prepare,
            padFrames,
            waitForPlaying,
            chooseCheats,
        });
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkMobile(session, name, { prepare, padFrames, waitForPlaying, chooseCheats });
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--gamepad-hint-only')) {
    try {
        await checkGamepadHint(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkGamepadHint(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
if (process.argv.includes('--gamepad-only') || process.argv.includes('--rocket-command-only')) {
    try {
        if (!process.argv.includes('--webkit-only')) {
            if (!process.argv.includes('--rocket-command-only'))
                await checkGamepad(browser, 'Chromium');
            await checkRocketCommand(browser, 'Chromium', { prepare, padFrames });
        }
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            if (!process.argv.includes('--rocket-command-only')) await checkGamepad(session, name);
            await checkRocketCommand(session, name, { prepare, padFrames });
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--scores-only')) {
    try {
        await checkHighScores(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkHighScores(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--music-platforms-only')) {
    await browser.close();
    for (const [name, engine] of [
        ['Chromium', chromium],
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const) {
        const session = await engine.launch({ headless: true });
        try {
            await checkTvMusicPlatforms(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--audio-only')) {
    try {
        if (!process.argv.includes('--webkit-only')) {
            await checkTitleMusic(browser, 'Chromium', { permissive: true });
            await checkRecordingFallbacks(browser, 'Chromium');
            await checkMusicSelection(browser, 'Chromium');
            await checkTvMusicPlatforms(browser, 'Chromium');
            await checkPendingSelection(browser);
            await checkStrictAutoplay();
            await checkPendingMusic(browser);
            await checkFailedInitialization(browser);
            await checkMissingAudio(browser);
            await checkMissingMusic(browser);
        }
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkTitleMusic(session, name);
            await checkRecordingFallbacks(session, name);
            await checkMusicSelection(session, name);
            await checkTvMusicPlatforms(session, name);
        } finally {
            await session.close();
        }
    }
    assert.deepEqual(errors, []);
    process.exit(0);
}
if (process.argv.includes('--effects-only')) {
    try {
        if (!process.argv.includes('--webkit-only')) await checkEffects(browser, 'Chromium');
    } finally {
        await browser.close();
    }
    for (const [name, engine] of (
        [
            ['Firefox', firefox],
            ['WebKit', webkit],
        ] as const
    ).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
        const session = await engine.launch({ headless: true });
        try {
            await checkEffects(session, name);
        } finally {
            await session.close();
        }
    }
    process.exit(0);
}
await checkBundledLoading();
if (!process.argv.includes('--webkit-only')) {
    try {
        await checkEffects(browser, 'Chromium');
        await checkPendingMusic(browser);
        if (process.argv.includes('--pending-music')) {
            console.log(
                'PASS: gameplay starts during pending title recording; late music cannot restart in game.',
            );
            await browser.close();
            process.exit(0);
        }
        await checkTitleMusic(browser, 'Chromium', { permissive: true });
        await checkRecordingFallbacks(browser, 'Chromium');
        await checkStrictAutoplay();
        await checkFailedInitialization(browser);
        const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
        activePage = page;
        await prepare(page);
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal((await page.locator('#title-screen h1').textContent())!, 'EXOLON');
        await page.locator('#game').click();
        await expectMusic(page, 'Chromium title');
        await page.screenshot({ path: '/tmp/exolon-title.png', fullPage: true });
        await openHome(page);
        await page.locator('#new-game').click();
        await page.waitForFunction(
            () => (document.getElementById('title-screen') as HTMLElement).hidden,
        );
        await waitForPlaying(page);
        assert.ok(
            await page.evaluate(() =>
                window.__exolonAudio.some((source) => source.loop && source.stopped),
            ),
            'Title music must stop when starting the game',
        );
        await page.keyboard.down('Space');
        await page.waitForFunction(
            () => (document.getElementById('ammo') as HTMLElement).textContent! === '98',
        );
        await page.waitForFunction(
            () => (document.getElementById('grenades') as HTMLElement).textContent! === '09',
        );
        await page.keyboard.up('Space');
        await page.screenshot({ path: '/tmp/exolon-rocket.png', fullPage: true });
        await activateControl(page.locator('#pause'));
        assert.equal(await overlayOpen(page), true);
        assert.equal(await page.locator('#overlay-title').isVisible(), false);
        assert.equal(await page.locator('#overlay-copy').isVisible(), false);
        await activateControl(page.locator('#pause'));
        await fireUntil(page, 'ammo', '97');
        await openHome(page);
        await page.locator('#restart').click();
        await waitForPlaying(page);
        await page.waitForFunction(
            () => (document.getElementById('ammo') as HTMLElement).textContent! === '99',
        );
        await fireUntil(page, 'ammo', '98');
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        assert.equal(await overlayOpen(page), true);
        await activateControl(page.locator('#pause'));
        await page.locator('#sound').click();
        assert.equal((await page.locator('#sound').getAttribute('aria-pressed'))!, 'true');
        await fireUntil(page, 'ammo', '97');
        await openHome(page);
        await page.locator('#restart').click();
        await waitForPlaying(page);
        await page.screenshot({ path: '/tmp/exolon-desktop.png', fullPage: true });
        await page.keyboard.down('ArrowRight');
        try {
            await page.evaluate(async () => {
                for (let frame = 0; frame < 8; frame++)
                    await new Promise((resolve) => requestAnimationFrame(resolve));
            });
            await page.screenshot({ path: '/tmp/exolon-human-walk.png', fullPage: true });
        } finally {
            await page.keyboard.up('ArrowRight');
        }
        await openHome(page);
        await page.locator('#menu').click();
        assert.equal(await menuPresented(page, 'title-screen'), true);
        assert.equal(
            (await page.evaluate(() => window.__exolonAudioSnapshot())).active,
            0,
            'Returning to the menu must preserve mute',
        );
        await page.locator('#sound').click();
        await expectMusic(page, 'Chromium menu return after unmute');
        await page.close();

        // Direct debug starts exercise data and rendering across all five stages.
        for (const screenIndex of [1, 24, 25, 49, 50, 74, 75, 99, 100, 124]) {
            const campaign = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
            activePage = campaign;
            await prepare(campaign);
            await begin(campaign, `?debug=1&screen=${screenIndex}`);
            assert.equal(
                (await campaign.locator('#sector').textContent())!,
                `${String(screenIndex + 1).padStart(3, '0')} / 125`,
            );
            assert.match(
                (await campaign.locator('#stage-label').textContent())!,
                new RegExp(`^0${Math.floor(screenIndex / 25) + 1} /`),
            );
            await campaign.screenshot({
                path: `/tmp/exolon-screen-${screenIndex + 1}.png`,
                fullPage: true,
            });
            await campaign.close();
        }

        // Enter the original stage gate, jumping its raised threshold.
        const bonus = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
        activePage = bonus;
        await prepare(bonus);
        await begin(bonus, '?debug=1&screen=24');
        await bonus.keyboard.down('ArrowRight');
        await bonus.keyboard.down('ArrowUp');
        await bonus.locator('#bonus-screen:not([hidden])').waitFor();
        await bonus.keyboard.up('ArrowRight');
        await bonus.keyboard.up('ArrowUp');
        await bonus.locator('#bonus-stop:not([disabled])').waitFor();
        await bonus.screenshot({ path: '/tmp/exolon-bonus.png', fullPage: true });
        await activateControl(bonus.locator('#pause'));
        assert.equal(await overlayOpen(bonus), true);
        await activateControl(bonus.locator('#pause'));
        await bonus.locator('#bonus-screen:not([hidden])').waitFor();
        await bonus.locator('#bonus-stop').click();
        await bonus.waitForFunction(
            () => (document.getElementById('sector') as HTMLElement).textContent! === '026 / 125',
        );
        assert.equal((await bonus.locator('#ammo').textContent())!, '99');
        assert.equal((await bonus.locator('#grenades').textContent())!, '10');
        await bonus.close();

        const mobile = await browser.newPage({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            userAgent: MOBILE_USER_AGENT,
            deviceScaleFactor: 2,
        });
        activePage = mobile;
        await prepare(mobile);
        await openGame(mobile, 'http://127.0.0.1:8091/');
        await mobile.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(
            await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await mobile.screenshot({ path: '/tmp/exolon-mobile-title.png', fullPage: true });
        await openHome(mobile);
        await mobile.locator('#new-game').tap();
        await waitForPlaying(mobile);
        const button = (await mobile.locator('[data-action="fire"]').boundingBox())!;
        const client = await mobile.context().newCDPSession(mobile);
        await client.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: button.x + 20, y: button.y + 20, id: 1 }],
        });
        await mobile.waitForFunction(
            () => (document.getElementById('ammo') as HTMLElement).textContent! === '98',
        );
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        assert.equal(await mobile.locator('.touch-controls__button_held').count(), 0);
        assert.equal(
            await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await mobile.screenshot({ path: '/tmp/exolon-mobile.png', fullPage: true });
        await mobile.close();

        await checkMissingAudio(browser);
        await checkMissingMusic(browser);
        assert.deepEqual(errors, []);
        console.log(
            'PASS: original title PCM music/start-stop, rockets, campaign starts across all five stages, stage gate/roulette/pause/nextstage, pause/restart/blur/mute, mobile touch/layout, missing audio/recording; no page errors.',
        );
    } catch (error) {
        if (activePage && !activePage.isClosed()) {
            console.error(
                await activePage.evaluate(() => ({
                    status: (document.getElementById('mission-status') as HTMLElement)?.textContent,
                    ammo: (document.getElementById('ammo') as HTMLElement)?.textContent,
                    overlay: (document.getElementById('overlay') as HTMLElement)?.hidden,
                    title: (document.getElementById('title-screen') as HTMLElement)?.hidden,
                    focus: document.activeElement?.id,
                })),
            );
            console.error(errors);
            await activePage.screenshot({ path: '/tmp/exolon-browser-failure.png' });
        }
        throw error;
    } finally {
        await browser.close();
    }
} else {
    await browser.close();
}

for (const [name, engine] of (
    [
        ['Firefox', firefox],
        ['WebKit', webkit],
    ] as const
).filter(([name]) => !process.argv.includes('--webkit-only') || name === 'WebKit')) {
    const session = await engine.launch({ headless: true });
    try {
        await checkEffects(session, name);
        await checkTitleMusic(session, name);
        await checkRecordingFallbacks(session, name);
        const page = await session.newPage({ viewport: { width: 1100, height: 1000 } });
        await prepare(page);
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.locator('#game').click();
        await expectMusic(page, name);
        await openHome(page);
        await page.locator('#new-game').click();
        await waitForPlaying(page);
        await fireUntil(page, 'ammo', '98');
        await activateControl(page.locator('#pause'));
        assert.equal(await overlayOpen(page), true);
        await openHome(page);
        await page.locator('#menu').click();
        assert.equal(await menuPresented(page, 'title-screen'), true);
        await expectMusic(page, `${name} menu return`);
        await begin(page, '?debug=1&screen=25');
        assert.equal((await page.locator('#sector').textContent())!, '026 / 125');
        await page.screenshot({ path: `/tmp/exolon-${name.toLowerCase()}.png`, fullPage: true });
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} original title music, native rendering, firing, pause/menu and stage 2.`,
        );
    } catch (error) {
        for (const page of session.contexts().flatMap((context) => context.pages())) {
            console.error(
                await page.evaluate(() => {
                    const rect = (
                        document.getElementById('new-game') as HTMLButtonElement
                    )?.getBoundingClientRect();
                    return {
                        rect: rect?.toJSON(),
                        scrollY,
                        innerHeight,
                        innerWidth,
                        visualHeight: visualViewport?.height,
                        visualOffset: visualViewport?.offsetTop,
                        hit: rect
                            ? document
                                  .elementFromPoint(
                                      rect.x + rect.width / 2,
                                      rect.y + rect.height / 2,
                                  )
                                  ?.outerHTML.slice(0, 180)
                            : null,
                    };
                }),
            );
            await page.screenshot({
                path: `/tmp/exolon-${name.toLowerCase()}-failure.png`,
                fullPage: true,
            });
        }
        throw error;
    } finally {
        await session.close();
    }
}
