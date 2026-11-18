import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { installVrSupport } from './vr-support.ts';
import { checkPickerShip } from './picker-ship.ts';
import { checkPickerStars } from './picker-stars.ts';
import { checkPickerTitle } from './picker-title.ts';
import { checkPickerStatic } from './picker-static.ts';

declare global {
    interface Window {
        __platformAudio: { resumes: number; active: number; running: boolean };
    }
}
export async function checkPlatformPicker(browser: Browser, name: string) {
    await checkPickerStatic(browser, name);
    await checkPickerTitle(browser, name);
    await checkPickerStars(browser, name);
    await checkPickerShip(browser, name);
    await checkVrLanding(browser);
    const modes = [
        ['retro', 'title-128k.mp3'],
        ['cpc', 'cpc/title.m4a'],
        ['c64', 'c64/title.m4a'],
        ['sharp-mz800', 'sharp-mz800/title.m4a'],
        ['remastered', 'title-ambient.m4a'],
    ] as const;
    for (const legacy of [false, true])
        for (const [mode, track] of modes) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
            const errors: string[] = [],
                requests: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('request', (request) => requests.push(request.url()));
            await page.addInitScript(() => {
                window.__platformAudio = { resumes: 0, active: 0, running: false };
                const Audio = window.AudioContext || window.webkitAudioContext;
                if (!Audio) return;
                const resume = Audio.prototype.resume;
                Audio.prototype.resume = function () {
                    window.__platformAudio.resumes++;
                    return resume.call(this);
                };
                const createSource = Audio.prototype.createBufferSource;
                Audio.prototype.createBufferSource = function () {
                    const source = createSource.call(this),
                        start = source.start;
                    source.start = function (...args) {
                        if (source.loop && source.buffer && source.buffer.duration > 5) {
                            window.__platformAudio.active++;
                            window.__platformAudio.running = source.context.state === 'running';
                        }
                        return start.apply(source, args);
                    };
                    return source;
                };
            });
            try {
                await page.goto('http://127.0.0.1:8091/?level=41' + (legacy ? '&legacy=1' : ''));
                await page.locator('[data-platform=retro][aria-disabled=false]').waitFor();
                assert.equal(await page.locator('#platform-picker').isVisible(), true);
                assert.deepEqual(
                    await page
                        .locator('[data-platform]')
                        .evaluateAll((elements) =>
                            elements.map((e) => (e as HTMLElement).dataset.platform),
                        ),
                    ['retro', 'c64', 'cpc', 'sharp-mz800', 'amiga', 'atari-st', 'remastered', 'vr'],
                );
                if (mode === 'retro')
                    for (const [platform, label] of [
                        ['amiga', 'Amiga 500'],
                        ['atari-st', 'Atari ST'],
                        ['vr', 'Exolon VR (In progress)'],
                    ]) {
                        const banner = page.locator(`[data-platform="${platform}"]`);
                        assert.equal(
                            (await banner.locator('.platform-picker__name').textContent())?.trim(),
                            label,
                        );
                        assert.equal(
                            await banner.getAttribute('aria-label'),
                            `Choose ${label} and start music`,
                        );
                        assert.equal(
                            await banner.locator('img').getAttribute('alt'),
                            `${label} loading screen`,
                        );
                    }
                await page.waitForFunction(() => {
                    const image = document.querySelector<HTMLImageElement>(
                        '[data-platform="remastered"] img',
                    );
                    return image?.complete && image.naturalWidth === 640;
                });
                assert.match(
                    (await page.locator('[data-platform="remastered"] img').getAttribute('src'))!,
                    /^\.\/assets\/images\/remastered\/previews\/banner\.jpg\?v=[a-f0-9]{16}$/,
                );
                assert.ok(
                    !requests.some((url) =>
                        new URL(url).pathname.endsWith('/intro-green-weapon.jpg'),
                    ),
                    'The picker must not fetch full-size Remastered artwork',
                );
                assert.equal(await page.locator('.game-viewport').count(), 0);
                assert.equal(await page.locator('.game-footer').count(), 0);
                assert.equal(await page.locator('#new-game, #game').count(), 0);
                assert.equal(await page.evaluate(() => window.__platformAudio.resumes), 0);
                const link = page.locator(`[data-platform="${mode}"][aria-disabled="false"]`);
                await link.waitFor();
                assert.equal(
                    await link
                        .locator('img')
                        .evaluate(
                            (image) =>
                                (image as HTMLImageElement).complete &&
                                (image as HTMLImageElement).naturalWidth > 0,
                        ),
                    true,
                );
                if (name === 'WebKit') {
                    await link.focus();
                    await page.keyboard.press('Enter');
                } else await link.click();
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                assert.equal(await page.locator('#settings-panel').isVisible(), false);
                assert.equal(
                    await page.locator('#settings-toggle').getAttribute('aria-expanded'),
                    'false',
                );
                assert.ok(
                    !requests.some((address) => {
                        const path = new URL(address).pathname;
                        return (
                            path.includes('/originals/') ||
                            path.endsWith('/intro-green-weapon.jpg') ||
                            /\/(?:title|game-over)\.wav$/.test(path)
                        );
                    }),
                    'The selected game uses direct runtime resources without old cover or music WAV',
                );

                await page.evaluate(
                    () =>
                        new Promise((resolve) =>
                            requestAnimationFrame(() => requestAnimationFrame(resolve)),
                        ),
                );
                assert.equal(
                    await page.locator('#game').getAttribute('data-intro'),
                    null,
                    'Choosing a banner opens the title directly without a second loading cover',
                );
                assert.equal(
                    await page.locator('#game').getAttribute('width'),
                    mode === 'remastered' ? '1024' : mode === 'sharp-mz800' ? '320' : '256',
                );
                await page.waitForFunction(() => window.__platformAudio.active > 0);
                assert.equal(
                    await page.evaluate(() => window.__platformAudio.running),
                    true,
                    'Music must play after the single platform gesture',
                );
                assert.ok(
                    requests.some((url) => new URL(url).pathname.endsWith('/' + track)),
                    track,
                );
                assert.equal(await page.locator('#platform-picker').isVisible(), false);
                assert.equal(await page.locator('#graphics-mode').inputValue(), mode);
                assert.equal(await page.locator('.game-viewport').isVisible(), true);
                assert.equal(
                    await page.locator('#game').getAttribute('data-menu'),
                    'title',
                    'Banner opens title, not gameplay',
                );
                assert.equal(await page.locator('#sector').textContent(), '041 / 125');
                assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
                await page.locator('#game').press('Enter');
                await page.locator('#game').press('Escape');
                assert.equal(
                    await page.locator('#platform-picker').isVisible(),
                    false,
                    'ESC returns to game title',
                );
                assert.deepEqual(errors, []);
            } finally {
                await page.close();
            }
        }
    for (const [width, height] of [
        [390, 844],
        [844, 390],
        [768, 1024],
        [1920, 1080],
    ]) {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
        try {
            await page.goto('http://127.0.0.1:8091/');
            await page.locator('[data-platform="remastered"][aria-disabled="false"]').waitFor();
            assert.ok(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                `${width} overflow`,
            );
            if (width >= 1101) {
                const boxes = await page
                    .locator('[data-platform]')
                    .evaluateAll((elements) =>
                        elements.map((element) => element.getBoundingClientRect().top),
                    );
                assert.equal(
                    new Set(boxes.map((top) => Math.round(top))).size,
                    2,
                    'Eight desktop banners occupy two rows',
                );
                assert.ok(
                    await page.evaluate(
                        () => document.documentElement.scrollHeight <= innerHeight + 1,
                    ),
                    'Desktop picker fits viewport height',
                );
            }
            for (const link of await page.locator('[data-platform]').all()) {
                const box = await link.boundingBox();
                assert.ok(
                    box &&
                        box.width >= 44 &&
                        box.height >= 44 &&
                        box.x >= 0 &&
                        box.x + box.width <= width + 1,
                );
            }
            await page.locator('[data-platform="remastered"]').tap();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            assert.equal(await page.locator('#platform-picker').isVisible(), false);
        } finally {
            await page.close();
        }
    }
    const tv = await browser.newPage({
        userAgent:
            'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/4.0 TV Safari/537.36',
    });
    try {
        await tv.goto('http://127.0.0.1:8091/');
        await tv.locator('[data-platform=retro][aria-disabled=false]').waitFor();
        await tv.keyboard.press('Escape');
        assert.equal(await tv.locator('#platform-picker').isVisible(), true);
        await tv.keyboard.press('Enter');
        await tv.waitForFunction(() => document.getElementById('game')?.dataset.menu === 'title');
        assert.equal(await tv.locator('#game').getAttribute('data-intro'), null);
    } finally {
        await tv.close();
    }
    await checkReducedMotion(browser, name);
    console.log(
        `PASS: ${name} eight banners, native/legacy platform audio after one gesture, direct title without a cover, level URL, keyboard/touch and responsive layouts.`,
    );
}

async function checkVrLanding(browser: Browser) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage();
        await installVrSupport(page);
        const requests: string[] = [];
        page.on('request', (request) => requests.push(request.url()));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        try {
            await page.goto(
                'http://127.0.0.1:8091/?game=vr&graphics=c64&level=41&test=keep' +
                    (legacy ? '&legacy=1' : '') +
                    '#scene',
            );
            await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            const banner = page.locator(`[data-platform="vr"][aria-disabled="${legacy}"]`);
            await banner.waitFor();
            if (!legacy) {
                const address = new URL((await banner.getAttribute('href'))!, page.url());
                assert.equal(address.searchParams.get('game'), 'vr');
                assert.equal(address.searchParams.get('graphics'), null);
                assert.equal(address.searchParams.get('level'), '41');
                assert.equal(address.searchParams.get('test'), 'keep');
                assert.equal(address.hash, '#scene');
            }
            assert.equal(await page.locator('#game').count(), 0);
            assert.equal(
                requests.some((url) => /\/(?:runtime|legacy)\/vr(?:-|\.js)/.test(url)),
                false,
                'VR stays deferred on its preferred landing URL',
            );
            if (legacy) {
                assert.equal(await banner.getAttribute('href'), null);
                await banner.click({ force: true });
                assert.equal(await page.locator('#platform-picker').isVisible(), true);
                assert.equal(await page.locator('#game').count(), 0);
                assert.equal(
                    requests.some((url) => /\/(?:runtime|legacy)\/vr(?:-|\.js)/.test(url)),
                    false,
                    'Legacy VR selection never requests a VR engine',
                );
                await page.locator('[data-platform="retro"]').focus();
                await page.keyboard.press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            }
        } finally {
            await page.close();
        }
    }
}

async function checkReducedMotion(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ reducedMotion: 'no-preference' });
        try {
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.goto('http://127.0.0.1:8091/' + (legacy ? '?legacy=1' : ''));
            const banner = page.locator('[data-platform=retro][aria-disabled=false]');
            await banner.waitFor();
            const animated = await banner.evaluate((element) =>
                getComputedStyle(element)
                    .transitionDuration.split(',')
                    .some((value) => parseFloat(value) > 0),
            );
            assert.equal(
                animated,
                true,
                'Banner transitions remain enabled without reduced motion',
            );
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await banner.focus();
            await page.waitForFunction(() => {
                const banner = document.querySelector('.platform-picker__banner')!;
                const button = document.getElementById('fullscreen')!;
                return [banner, button].every((element) =>
                    getComputedStyle(element)
                        .transitionDuration.split(',')
                        .every((value) => parseFloat(value) === 0),
                );
            });
            assert.equal(
                await banner.evaluate((element) => getComputedStyle(element).transform),
                'none',
            );
            assert.equal(
                await page
                    .locator('.platform-picker__heading')
                    .evaluate((element) => getComputedStyle(element).animationName),
                'none',
            );
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            assert.equal(
                await banner.evaluate((element) =>
                    getComputedStyle(element)
                        .transitionDuration.split(',')
                        .some((value) => parseFloat(value) > 0),
                ),
                true,
                'Transitions return when the reduced-motion preference is removed',
            );
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} reduced motion disables banner/button transitions and title animation, restores transitions on preference change, in modern/legacy.`,
    );
}
