import type { Locator, Page } from 'playwright';
import { closeHome, closeSettings, openHome, openSettings } from './navigation.ts';

export async function prepareControl(locator: Locator) {
    const owner = await locator.evaluate((element) =>
        element.closest('#home-panel')
            ? 'home'
            : element.closest('#settings-panel')
              ? 'settings'
              : null,
    );
    if (owner === 'home') await openHome(locator.page());
    else if (owner === 'settings') await openSettings(locator.page());
    else {
        await closeHome(locator.page());
        await closeSettings(locator.page());
    }
}

export async function activateControl(locator: Locator, touch = false) {
    if ((await locator.getAttribute('id')) === 'pause') {
        await closeHome(locator.page());
        await closeSettings(locator.page());
        await locator.page().locator('#game').focus();
        await locator.page().keyboard.press('Pause');
        return;
    }
    await prepareControl(locator);
    if (touch) await locator.tap();
    else await locator.click();
}

export async function menuPresented(
    page: Page,
    section: 'title-screen' | 'title-intro' | 'high-scores',
) {
    const menu = await page.locator('#game').getAttribute('data-menu');
    if (section === 'high-scores') return menu === 'scores';
    if (section === 'title-intro') return menu === 'title' || menu === 'menu';
    return menu === 'title' || menu === 'menu' || menu === 'scores';
}
