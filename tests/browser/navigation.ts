import type { Page } from 'playwright';
import { readLaunchOptions } from '../../src/utils/settings.ts';

export async function openHome(page: Page) {
    if (await page.locator('#home-panel').isHidden()) {
        await page.locator('#home').focus();
        await page.keyboard.press('Enter');
    }
}
export async function closeHome(page: Page) {
    if (await page.locator('#home-panel').isVisible()) {
        await page.locator('#home').focus();
        await page.keyboard.press('Enter');
    }
}

export async function openSettings(page: Page) {
    if (await page.locator('#settings-panel').isHidden()) {
        await page.locator('#settings-toggle').focus();
        await page.keyboard.press('Enter');
    }
}
export async function closeSettings(page: Page) {
    if (await page.locator('#settings-panel').isVisible()) {
        await page.locator('#settings-close').focus();
        await page.keyboard.press('Enter');
    }
}

// Existing game scenarios explicitly enter through the new first screen.
// The dedicated picker suite tests the entrance itself without this fixture.
export async function enterGame(page: Page, expandSettings = true) {
    await page.locator('#platform-picker').waitFor({ state: 'attached' });
    if (!(await page.locator('#platform-picker').isVisible())) return;
    await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
    const saved = await page.evaluate(() => {
        try {
            return localStorage.getItem('exolon-graphics');
        } catch {
            return null;
        }
    });
    const desired = readLaunchOptions(new URL(page.url()).search, saved).graphicsMode;
    const card = ['retro', 'cpc', 'c64', 'sharp-mz800', 'remastered'].includes(desired)
        ? desired
        : 'retro';
    if (['c64', 'cpc', 'sharp-mz800'].includes(card)) {
        await page.waitForFunction((mode) => {
            const link = document.querySelector<HTMLElement>(`[data-platform="${mode}"]`)!;
            return (
                link.getAttribute('aria-disabled') === 'false' ||
                link.dataset.unavailable === 'true'
            );
        }, card);
    }
    const requested = page.locator(`[data-platform="${card}"]`);
    const chosen = (await requested.getAttribute('aria-disabled')) === 'false' ? card : 'retro';
    await page.locator(`[data-platform="${chosen}"]`).focus();
    await page.keyboard.press('Enter');
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
    // Most game scenarios exercise footer controls; default-state checks opt out.
    if (
        expandSettings &&
        (await page.locator('#settings-toggle').getAttribute('aria-expanded')) === 'false'
    ) {
        await page.locator('#settings-toggle').focus();
        await page.keyboard.press('Enter');
    }
    if (!['retro', 'cpc', 'c64', 'sharp-mz800', 'remastered'].includes(desired)) {
        await page.locator('#graphics-mode').evaluate((element, value) => {
            (element as HTMLSelectElement).value = value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }, desired);
    }
    if (['c64', 'cpc', 'sharp-mz800'].includes(chosen))
        await page.waitForFunction(
            (mode) =>
                document.getElementById('game')?.dataset.graphics === mode ||
                document.querySelector<HTMLOptionElement>(`#graphics-mode option[value="${mode}"]`)
                    ?.disabled,
            chosen,
        );
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
}
export async function openGame(
    page: Page,
    url: string,
    options: Parameters<Page['goto']>[1] & { expandSettings?: boolean } = {},
) {
    const { expandSettings = true, ...navigationOptions } = options;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', ...navigationOptions });
    await enterGame(page, expandSettings);
    return response;
}
export async function reloadGame(page: Page, expandSettings = true) {
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    await enterGame(page, expandSettings);
    return response;
}
