import { openHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

// Keep these baselines independent of production constants: the original-machine
// research must detect an accidental return to the former 30 Hz simulation.
const INTERVALS = {
    cpc: 52,
    retro: 47,
    c64: 47,
    'sharp-mz800': 45,
    remastered: 1000 / 30,
    gameboy: 1000 / 30,
    'gameboy-color': 1000 / 30,
};

declare global {
    interface Window {
        __motionFrame: (now: number) => void;
    }
}

async function installManualRaf(page: Page) {
    await page.addInitScript(() => {
        let sequence = 0;
        const pending = new Map<number, FrameRequestCallback>();
        window.requestAnimationFrame = (callback) => {
            pending.set(++sequence, callback);
            return sequence;
        };
        window.cancelAnimationFrame = (id) => pending.delete(id);
        window.__motionFrame = (now) => {
            const callbacks = Array.from(pending.values());
            pending.clear();
            callbacks.forEach((callback) => callback(now));
        };
    });
}

async function select(page: Page, id: string, value: string) {
    await page.waitForFunction(
        ({ id, value }) => {
            const option = document.querySelector<HTMLOptionElement>(
                `#${id} option[value="${value}"]`,
            );
            return option && !option.disabled;
        },
        { id, value },
        { polling: 20 },
    );
    // Native select events avoid Playwright actionability's RAF stability wait.
    await page.locator(`#${id}`).evaluate((element, selected) => {
        (element as HTMLSelectElement).value = selected;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await page.waitForFunction(
        ({ id, value }) =>
            id === 'graphics-mode'
                ? document.getElementById('game')?.dataset.graphics === value
                : (document.getElementById(id) as HTMLSelectElement).value === value,
        { id, value },
        { polling: 20 },
    );
}

export async function checkMotionTiming(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        const errors: string[] = [];
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => errors.push(error.message));
        // Audio modules still execute; suppress only large media downloads.
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        await installManualRaf(page);
        let now = 0;
        const frame = async (elapsed = 0) => {
            now += elapsed;
            await page.evaluate((time) => window.__motionFrame(time), now);
        };
        const grenades = async () => (await page.locator('#grenades').textContent())?.trim();
        const expectGrenades = async (expected: string, detail: string) =>
            assert.equal(
                await grenades(),
                expected,
                `${name} ${legacy ? 'legacy' : 'native'} ${detail}`,
            );
        const restart = async () => {
            await page.keyboard.up('Space');
            await openHome(page);
            await page.locator('#restart').focus();
            await page.keyboard.press('Enter');
            await frame();
            await expectGrenades('10', 'restart restores ammunition');
            await page.locator('#game').focus();
        };
        const holdFourteen = async (interval: number) => {
            await page.locator('#game').focus();
            await page.keyboard.down('Space');
            for (let tick = 0; tick < 14; tick++) await frame(interval);
            await expectGrenades('10', '14 updates do not launch the heavy rocket');
        };
        const fifteenth = async (interval: number, detail: string) => {
            await frame(interval - 0.1);
            await expectGrenades('10', `${detail}: no update before the interval boundary`);
            await frame(0.1);
            await expectGrenades('09', `${detail}: update 15 launches the heavy rocket`);
            await page.keyboard.up('Space');
        };
        try {
            await page.goto(`http://127.0.0.1:8091/?graphics=cpc${legacy ? '&legacy=1' : ''}`);
            await page.locator('[data-platform="cpc"][aria-disabled="false"]').waitFor();
            await page.locator('[data-platform="cpc"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await page.locator('#game').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () => !(document.getElementById('pause') as HTMLButtonElement).hidden,
                null,
                { polling: 20 },
            );
            await frame();
            for (const [mode, interval] of Object.entries(INTERVALS)) {
                await select(page, 'graphics-mode', mode);
                await restart();
                await holdFourteen(interval);
                await fifteenth(interval, `${mode} cadence`);
            }

            // A change during play must take effect without restarting or adding
            // an update. Keep the original 14 held-fire updates across the change.
            await select(page, 'graphics-mode', 'cpc');
            await restart();
            await holdFourteen(INTERVALS.cpc);
            await select(page, 'graphics-mode', 'c64');
            await expectGrenades('10', 'changing graphics does not advance gameplay');
            await frame();
            await fifteenth(INTERVALS.c64, 'live CPC to C64 change');

            // Split has one shared model. The left selection controls cadence;
            // the right selection changes presentation/audio only.
            await select(page, 'graphics-mode', 'split');
            await select(page, 'split-left', 'cpc');
            await select(page, 'split-right', 'c64');
            await restart();
            await holdFourteen(INTERVALS.cpc);
            await select(page, 'split-right', 'sharp-mz800');
            await expectGrenades('10', 'changing Split right does not advance gameplay');
            await frame();
            await fifteenth(INTERVALS.cpc, 'Split keeps left CPC cadence after right change');
            await restart();
            await holdFourteen(INTERVALS.cpc);
            await select(page, 'split-left', 'c64');
            await expectGrenades('10', 'changing Split left does not advance gameplay');
            await frame();
            await fifteenth(INTERVALS.c64, 'Split adopts changed left C64 cadence');

            await select(page, 'graphics-mode', 'cpc');
            await restart();
            await page.keyboard.press('Pause');
            await page.waitForFunction(
                () => document.getElementById('pause')?.getAttribute('aria-pressed') === 'true',
                null,
                { polling: 20 },
            );
            await select(page, 'graphics-mode', 'c64');
            await page.locator('#game').focus();
            await page.keyboard.down('Space');
            for (let tick = 0; tick < 20; tick++) await frame(INTERVALS.c64);
            await expectGrenades('10', 'graphics change and RAF callbacks preserve pause');
            await page.keyboard.up('Space');
            await page.keyboard.press('Pause');
            await frame();
            await holdFourteen(INTERVALS.c64);
            await fifteenth(INTERVALS.c64, 'paused graphics choice applies after resume');
            assert.deepEqual(errors, [], `${name} timing scenarios have no browser errors`);
        } finally {
            await page.close();
        }
    }
}
