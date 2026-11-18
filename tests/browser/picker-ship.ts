import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

async function checkShipPixels(page: Page) {
    await page.evaluate(() => {
        const source = document.querySelector('.platform-picker__ship-flight')!;
        const probe = source.cloneNode(true) as HTMLElement;
        probe.setAttribute('data-ship-pixel-probe', '');
        Object.assign(probe.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '80px',
            height: '12px',
            animation: 'none',
            transform: 'none',
            background: '#000',
            zIndex: '2147483647',
        });
        document.body.appendChild(probe);
    });
    const probe = page.locator('[data-ship-pixel-probe]');
    async function pixelsAt(time: number) {
        await probe
            .locator(
                '.platform-picker__ship-engine-light, .platform-picker__ship-exhaust, .platform-picker__ship-beacon',
            )
            .evaluateAll((elements, time) => {
                for (const element of elements)
                    for (const animation of element.getAnimations()) {
                        animation.pause();
                        animation.currentTime = time;
                    }
            }, time);
        const screenshot = await probe.screenshot();
        return page.evaluate(async (base64) => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + base64;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return [
                [56, 6],
                [4, 6],
                [14, 6],
                [25, 6],
                [38, 6],
                [72, 6],
                [65, 0],
            ].map(([x, y]) => Array.from(context.getImageData(x!, y!, 1, 1).data).slice(0, 3));
        }, screenshot.toString('base64'));
    }
    try {
        const bright = await pixelsAt(0);
        const beaconOff = await pixelsAt(500);
        const beaconRepeat = await pixelsAt(1000);
        const dim = await pixelsAt(1200);
        for (const pixels of [bright, beaconRepeat]) {
            const [red, green, blue] = pixels[6]!;
            assert.ok(
                red! > 200 && red! > green! * 2 && red! > blue! * 2,
                'The ship beacon flashes visibly red and repeats during flight',
            );
        }
        assert.ok(
            beaconOff[6]![0]! < bright[6]![0]! * 0.6,
            'The ship beacon switches off between flashes',
        );
        const brightNozzle = bright[0]!.reduce((sum, value) => sum + value, 0);
        const dimNozzle = dim[0]!.reduce((sum, value) => sum + value, 0);
        assert.ok(brightNozzle > 400, 'The rendered nozzle has a clearly bright phase');
        assert.ok(
            dimNozzle < brightNozzle * 0.4,
            'The rendered nozzle dims visibly, without a static bright layer underneath',
        );
        for (const index of [1, 2, 3, 4]) {
            const brightTrail = bright[index]!.reduce((sum, value) => sum + value, 0);
            const dimTrail = dim[index]!.reduce((sum, value) => sum + value, 0);
            assert.ok(
                dimTrail > brightTrail * 0.2 && dimTrail < brightTrail * 0.7,
                'Every rendered trail segment pulses while remaining visible',
            );
        }
        assert.deepEqual(dim[5], bright[5], 'Rendered hull pixels stay unchanged');
    } finally {
        await probe.evaluate((element) => element.remove());
    }
}

export async function checkPickerShip(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
            reducedMotion: 'no-preference',
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
        try {
            await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`, {
                waitUntil: 'networkidle',
            });
            await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            await page.clock.pauseAt(new Date('2026-11-22T00:00:05Z'));
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            const flight = page.locator('.platform-picker__ship-flight');
            assert.equal(await flight.count(), 1, 'The picker contains one decorative ship');
            const active = page.locator('.platform-picker__ship-flight_active');
            await page.clock.fastForward(2000);
            assert.equal(await active.count(), 0, 'A flyby waits before entering');
            await page.clock.fastForward(4000);
            assert.equal(await active.count(), 1, 'The ship starts within six seconds');
            await active.waitFor();
            const firstY = await flight.evaluate((element) => element.style.top);
            const firstX = (await flight.boundingBox())!.x;
            await page.waitForTimeout(200);
            assert.ok((await flight.boundingBox())!.x > firstX, 'The ship moves right');

            const motion = await flight.evaluate((element) => {
                const animation = element.getAnimations()[0]!;
                const previousTime = animation.currentTime;
                const duration = parseFloat(getComputedStyle(element).animationDuration) * 1000;
                animation.pause();
                const positions = [0, 0.3, 0.6, 0.9, 0.95, 0.98, 1].map((progress) => {
                    animation.currentTime = duration * progress;
                    return element.getBoundingClientRect().left;
                });
                animation.currentTime = previousTime;
                animation.play();
                return positions;
            });
            const distance = motion[6]! - motion[0]!;
            const cruiseSpeed = (motion[2]! - motion[1]!) / 0.3;
            const exitSpeed = (motion[5]! - motion[4]!) / 0.03;
            assert.ok(
                Math.abs((motion[3]! - motion[0]!) / distance - 0.75) < 0.01,
                'The ship cruises until the final quarter of its path',
            );
            assert.ok(exitSpeed > cruiseSpeed * 3, 'The ship accelerates sharply before exiting');

            const light = page.locator('.platform-picker__ship-engine-light');
            const phases = await light.evaluate((element) => {
                const trail = document.querySelector('.platform-picker__ship-exhaust')!;
                const animations = [...element.getAnimations(), ...trail.getAnimations()];
                for (const animation of animations) animation.pause();
                const samples = [0, 600, 1200, 1800, 2400].map((time) => {
                    for (const animation of animations) animation.currentTime = time;
                    return {
                        light: Number(getComputedStyle(element).opacity),
                        trail: Number(getComputedStyle(trail).opacity),
                    };
                });
                for (const animation of animations) animation.play();
                return samples;
            });
            for (const index of [0, 4])
                assert.ok(phases[index]!.light > 0.95, 'The nozzle light reaches full brightness');
            for (const index of [1, 3])
                assert.ok(
                    phases[index]!.light > 0.2 && phases[index]!.light < 0.8,
                    'The nozzle light fades through intermediate brightness without a hard blink',
                );
            assert.ok(phases[2]!.light < 0.2, 'The nozzle glow has a distinct dim phase');
            assert.ok(phases[2]!.trail < 0.6, 'The whole trail shares the dim phase');
            for (const phase of phases)
                assert.ok(phase.trail > 0.3, 'The entire trail stays visible throughout the pulse');
            await checkShipPixels(page);

            async function finishFlight() {
                await flight.evaluate((element) => {
                    for (const animation of element.getAnimations()) animation.finish();
                });
                await active.waitFor({ state: 'hidden' });
            }
            await finishFlight();
            await page.clock.fastForward(2000);
            assert.equal(await active.count(), 0, 'The timeout starts after the tail exits');
            await page.clock.fastForward(4000);
            assert.equal(await active.count(), 1, 'Repeat flights also start within six seconds');
            await active.waitFor();
            assert.notEqual(
                await flight.evaluate((element) => element.style.top),
                firstY,
                'The next flight uses a different height',
            );

            async function setMotion(reducedMotion: 'reduce' | 'no-preference') {
                const changed = page.evaluate(
                    () =>
                        new Promise<void>((resolve) => {
                            matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
                                'change',
                                () => resolve(),
                                { once: true },
                            );
                        }),
                );
                await page.emulateMedia({ reducedMotion });
                await changed;
            }
            await setMotion('reduce');
            await active.waitFor({ state: 'hidden' });
            await page.clock.fastForward(60000);
            assert.equal(await flight.isVisible(), false, 'Reduced motion stops flybys');
            await setMotion('no-preference');
            await page.clock.fastForward(6000);
            await active.waitFor();
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await active.waitFor({ state: 'hidden' });
            await page.clock.fastForward(60000);
            assert.equal(await active.count(), 0, 'Pagehide cancels flight timers');
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.fastForward(6000);
            await active.waitFor();

            const oldFlight = (await flight.elementHandle())!;
            await page.locator('[data-platform="retro"]').click();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            const disposedMarkup = await oldFlight.evaluate((element) => element.outerHTML);
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.fastForward(60000);
            assert.equal(
                await oldFlight.evaluate((element) => element.outerHTML),
                disposedMarkup,
                'Disposed landing timers and listeners never touch its old ship',
            );
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} picker ship waits between flights, accelerates through its final quarter, changes height and stops on reduced motion, pagehide and disposal in modern/legacy.`,
    );
}
