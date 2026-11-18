import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

type Support =
    'supported' | 'missing' | 'unsupported' | 'rejected' | 'pending' | 'no-webgl' | 'insecure';
declare global {
    interface Window {
        __vrCapability: {
            available: boolean;
            queries: number;
            resolvers: ((supported: boolean) => void)[];
            system: EventTarget;
        };
        __oldVrBanner?: HTMLElement;
    }
}

// Browser capability fixtures exercise the app's existing entry and controller.
// No successful immersive session or physical headset behavior is simulated.
export async function installVrSupport(page: Page, support: Support = 'supported') {
    await page.addInitScript((support) => {
        const system = Object.assign(new EventTarget(), {
            isSessionSupported(mode: string) {
                window.__vrCapability.queries++;
                if (support === 'rejected') return Promise.reject(new Error('XR unavailable'));
                if (support === 'pending')
                    return new Promise<boolean>((resolve) =>
                        window.__vrCapability.resolvers.push(resolve),
                    );
                return Promise.resolve(mode === 'immersive-vr' && window.__vrCapability.available);
            },
            requestSession() {
                return Promise.reject(
                    new DOMException('Test permission denied', 'NotAllowedError'),
                );
            },
        });
        window.__vrCapability = {
            available: support !== 'unsupported',
            queries: 0,
            resolvers: [],
            system,
        };
        Object.defineProperty(navigator, 'xr', {
            configurable: true,
            value: support === 'missing' ? undefined : system,
        });
        if (support === 'insecure')
            Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
        if (support === 'no-webgl') {
            const original = HTMLCanvasElement.prototype.getContext;
            function getContext(this: HTMLCanvasElement, type: string, options?: object) {
                return type === 'webgl2' ? null : original.call(this, type, options);
            }
            Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
                configurable: true,
                value: getContext,
            });
        }
    }, support);
}

async function settled(page: Page) {
    await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
    await page.waitForFunction(
        () =>
            document.querySelector<HTMLElement>('[data-platform="vr"]')?.title !==
            'Checking VR support…',
    );
}

function bannerAppearance(element: Element) {
    const style = getComputedStyle(element);
    return {
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        outline: style.outline,
        transform: style.transform,
        zIndex: style.zIndex,
    };
}

export async function checkVrSupport(browser: Browser, name: string) {
    for (const support of [
        'missing',
        'unsupported',
        'rejected',
        'no-webgl',
        'insecure',
        'legacy',
    ] as const) {
        const page = await browser.newPage();
        await installVrSupport(page, support === 'legacy' ? 'supported' : support);
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        const requests: string[] = [],
            errors: string[] = [];
        page.on('request', (request) => requests.push(request.url()));
        page.on('pageerror', (error) => errors.push(error.message));
        try {
            await page.goto(
                'http://127.0.0.1:8091/?game=vr' + (support === 'legacy' ? '&legacy=1' : ''),
            );
            await settled(page);
            const card = page.locator('[data-platform="vr"]');
            assert.equal(
                await card.getAttribute('aria-disabled'),
                'true',
                `${support}: VR disabled`,
            );
            assert.equal(await card.getAttribute('href'), null);
            assert.equal(await card.getAttribute('tabindex'), '-1');
            assert.equal(
                await card.evaluate((element) => getComputedStyle(element).filter),
                'grayscale(1)',
            );
            assert.ok(await card.getAttribute('title'));
            const appearance = await card.evaluate(bannerAppearance);
            await card.hover();
            assert.deepEqual(
                await card.evaluate(bannerAppearance),
                appearance,
                `${support}: hovering an unavailable VR banner leaves its appearance unchanged`,
            );
            await card.focus();
            assert.deepEqual(
                await card.evaluate(bannerAppearance),
                appearance,
                `${support}: focusing an unavailable VR banner leaves its appearance unchanged`,
            );
            await card.click({ force: true });
            await card.dispatchEvent('click', { ctrlKey: true, button: 0 });
            await page.keyboard.press('Enter');
            await page.keyboard.press('Space');
            assert.equal(await page.locator('#game').count(), 0);
            assert.ok(
                !requests.some((address) =>
                    /\/runtime\/vr\.js|\/(?:data|assets\/graphics)\/|\.(?:mp3|m4a|wav)(?:\?|$)/.test(
                        address,
                    ),
                ),
            );
            await page.locator('[data-platform="remastered"]').focus();
            await page.keyboard.press('ArrowRight');
            assert.equal(
                await page.evaluate(
                    () => (document.activeElement as HTMLElement)?.dataset.platform,
                ),
                'retro',
            );
            await page.keyboard.press('ArrowLeft');
            assert.equal(
                await page.evaluate(
                    () => (document.activeElement as HTMLElement)?.dataset.platform,
                ),
                'remastered',
            );
            await page.keyboard.press('Tab');
            assert.notEqual(
                await page.evaluate(
                    () => (document.activeElement as HTMLElement)?.dataset.platform,
                ),
                'vr',
            );
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }

    const page = await browser.newPage();
    await installVrSupport(page, 'pending');
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    try {
        await page.goto('http://127.0.0.1:8091/?game=vr&level=41&test=keep#scene');
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 1);
        const card = page.locator('[data-platform="vr"]');
        assert.equal(await card.getAttribute('aria-disabled'), 'true');
        await card.click({ force: true });
        assert.equal(await page.locator('#game').count(), 0);
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 2);
        await page.evaluate(() => {
            window.__vrCapability.resolvers[1](false);
            window.__vrCapability.resolvers[0](true);
        });
        await settled(page);
        assert.equal(
            await card.getAttribute('aria-disabled'),
            'true',
            'An obsolete support result cannot reenable VR',
        );
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 3);
        await page.evaluate(() => window.__vrCapability.resolvers[2](true));
        await page.locator('[data-platform="vr"][aria-disabled="false"]').waitFor();
        assert.equal(await card.evaluate((element) => getComputedStyle(element).filter), 'none');
        assert.equal(await card.getAttribute('tabindex'), '0');
        const address = new URL((await card.getAttribute('href'))!, page.url());
        assert.equal(address.searchParams.get('game'), 'vr');
        assert.equal(address.searchParams.get('level'), '41');
        assert.equal(address.searchParams.get('test'), 'keep');
        assert.equal(address.hash, '#scene');
        await card.focus();
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 4);
        assert.equal(
            await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.platform),
            'vr',
            'A pending recheck preserves the selected VR banner',
        );
        await page.evaluate(() => window.__vrCapability.resolvers[3](true));
        await page.locator('[data-platform="vr"][aria-disabled="false"]').waitFor();
        assert.equal(
            await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.platform),
            'vr',
            'A positive recheck cannot redirect the next activation to another game',
        );
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 5);
        await page.evaluate(() => window.__vrCapability.resolvers[4](false));
        await settled(page);
        assert.notEqual(
            await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.platform),
            'vr',
            'Confirmed loss moves focus out of the unavailable banner',
        );
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        await page.waitForFunction(() => window.__vrCapability.resolvers.length === 6);
        await page.evaluate(() => {
            window.__oldVrBanner = document.querySelector<HTMLElement>('[data-platform="vr"]')!;
        });
        await page.locator('[data-platform="retro"]').press('Enter');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        const oldBanner = await page.evaluate(() => window.__oldVrBanner!.outerHTML);
        await page.evaluate(() => {
            window.__vrCapability.resolvers[5](true);
        });
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'retro');
        assert.equal(
            await page.evaluate(() => window.__oldVrBanner!.outerHTML),
            oldBanner,
            'Late capability probes never touch disposed banner DOM',
        );
        const queries = await page.evaluate(() => window.__vrCapability.queries);
        await page.evaluate(() =>
            window.__vrCapability.system.dispatchEvent(new Event('devicechange')),
        );
        assert.equal(
            await page.evaluate(() => window.__vrCapability.queries),
            queries,
            'Unmount removes capability subscriptions',
        );
    } finally {
        await page.close();
    }
    console.log(
        `PASS: ${name} VR banner grayscale, unavailable/legacy/pending activation gates, keyboard skipping, capability changes and stale probes.`,
    );
}
