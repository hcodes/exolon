import { serveReferenceModules } from './reference-mode.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { openGame } from './navigation.ts';

declare global {
    interface Window {
        __uiControls: { changes: number; cancellations: number; dispose(): void };
    }
}

export async function checkUiControls(browser: Browser, name: string) {
    const page = await browser.newPage({ hasTouch: name === 'WebKit' });
    await serveReferenceModules(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const activate = (selector: string) =>
        name === 'WebKit' ? page.locator(selector).tap() : page.locator(selector).click();
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.evaluate(async () => {
            const [
                { render },
                { jsx },
                { Modal },
                { Button },
                { Select },
                { Checkbox },
                { Input },
                { createModalControl },
                { createEventScope },
            ] = await Promise.all([
                import('./node_modules/preact/dist/preact.js' as string) as Promise<
                    typeof import('preact')
                >,
                import('./node_modules/preact/jsx-runtime/dist/jsxRuntime.js' as string),
                import('./components/Modal/index.js' as string),
                import('./components/Button/index.js' as string),
                import('./components/Select/index.js' as string),
                import('./components/Checkbox/index.js' as string),
                import('./components/Input/index.js' as string),
                import('./controllers/modal.js' as string),
                import('./lib/events.js' as string),
            ]);
            // The production bundle keeps jsx/render; unused Preact exports are tree-shaken.
            const h = (type: unknown, props: Record<string, unknown>, ...children: unknown[]) =>
                jsx(type, { ...props, children });
            const root = document.getElementById('app')!;
            render(null, root);
            window.__uiControls = { changes: 0, cancellations: 0, dispose() {} };
            const changed = () => window.__uiControls.changes++;
            render(
                h(
                    'main',
                    {},
                    h(Button, { id: 'ui-open', type: 'button' }, 'Open'),
                    h(
                        Modal,
                        {
                            id: 'ui-modal',
                            class: 'fixture-modal',
                            hidden: true,
                            'aria-label': 'Test settings',
                        },
                        h(
                            'section',
                            { style: 'padding:24px;background:#101f2b' },
                            h(Input, {
                                id: 'ui-input',
                                name: 'player',
                                class: 'fixture-input',
                                'aria-label': 'Player',
                                maxLength: 4,
                                onInput: changed,
                            }),
                            h(Checkbox, {
                                id: 'ui-checkbox',
                                'aria-label': 'Option',
                                onChange: changed,
                            }),
                            h(Checkbox, {
                                id: 'ui-disabled',
                                disabled: true,
                                checked: true,
                                'aria-label': 'Unavailable option',
                            }),
                            h(Input, { id: 'ui-hidden', hidden: true }),
                            h(
                                Select,
                                {
                                    id: 'ui-select',
                                    name: 'platform',
                                    'aria-label': 'Platform',
                                    onChange: changed,
                                },
                                h('option', { value: 'zx' }, 'ZX Spectrum'),
                                h('option', { value: 'amiga' }, 'Amiga'),
                            ),
                            h(Button, { id: 'ui-close', type: 'button' }, 'Close'),
                        ),
                    ),
                ),
                root,
            );
            const events = createEventScope(window);
            const modal = createModalControl({
                element: document.getElementById('ui-modal')!,
                events,
                onCancel: () => {
                    window.__uiControls.cancellations++;
                    modal.close();
                },
            });
            events.on(document.getElementById('ui-open'), 'click', () =>
                modal.open(document.getElementById('ui-open')!),
            );
            events.on(document.getElementById('ui-close'), 'click', () => modal.close());
            window.__uiControls.dispose = () => {
                events.destroy();
                render(null, root);
            };
        });
        assert.equal(await page.locator('#ui-modal').isVisible(), false);
        await activate('#ui-open');
        const modal = page.getByRole('dialog', { name: 'Test settings' });
        await modal.waitFor();
        assert.equal(await modal.getAttribute('aria-modal'), 'true');
        assert.ok((await modal.getAttribute('class'))!.includes('fixture-modal'));
        assert.equal(
            await page.locator('#ui-input').evaluate((node) => node === document.activeElement),
            true,
        );
        await page.locator('#ui-input').fill('NOVA');
        assert.equal(await page.locator('#ui-input').getAttribute('name'), 'player');
        assert.equal(await page.locator('#ui-input').getAttribute('maxlength'), '4');
        assert.ok(
            (await page.locator('#ui-input').getAttribute('class'))!.includes('fixture-input'),
        );
        await activate('#ui-checkbox');
        assert.equal(await page.locator('#ui-checkbox').isChecked(), true);
        assert.equal(await page.locator('#ui-disabled').isDisabled(), true);
        assert.equal(await page.locator('#ui-disabled').isChecked(), true);
        await page.locator('#ui-select').selectOption('amiga');
        assert.equal(await page.locator('#ui-select').inputValue(), 'amiga');
        assert.equal(await page.evaluate(() => window.__uiControls.changes), 3);
        await page.evaluate(() => document.getElementById('app')!.classList.add('game-app_tv'));
        for (const selector of ['#ui-input', '#ui-checkbox', '#ui-select', '#ui-close']) {
            await page.locator(selector).focus();
            assert.deepEqual(
                await page.locator(selector).evaluate((node) => {
                    const style = getComputedStyle(node);
                    return [
                        style.outlineWidth,
                        style.outlineStyle,
                        style.outlineColor,
                        style.outlineOffset,
                    ];
                }),
                ['3px', 'solid', 'rgb(164, 245, 219)', '3px'],
                `${name} TV focus: ${selector}`,
            );
        }
        await page.evaluate(() => document.getElementById('app')!.classList.remove('game-app_tv'));
        await page.locator('#ui-close').focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await page.locator('#ui-input').evaluate((node) => node === document.activeElement),
            true,
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
            await page.locator('#ui-close').evaluate((node) => node === document.activeElement),
            true,
        );
        await activate('#ui-input');
        assert.equal(await modal.isVisible(), true, 'Clicks inside content keep the modal open');
        await page.keyboard.press('Escape');
        assert.equal(await modal.isVisible(), false);
        assert.equal(
            await page.locator('#ui-open').evaluate((node) => node === document.activeElement),
            true,
        );
        await activate('#ui-open');
        if (name === 'WebKit') await modal.tap({ position: { x: 2, y: 2 } });
        else await modal.click({ position: { x: 2, y: 2 } });
        assert.equal(await modal.isVisible(), false);
        assert.equal(await page.evaluate(() => window.__uiControls.cancellations), 2);
        await page.evaluate(() => {
            document
                .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
                    '#ui-modal input, #ui-modal select, #ui-modal button',
                )
                .forEach((node) => (node.disabled = true));
        });
        await activate('#ui-open');
        assert.equal(await modal.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await modal.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__uiControls.dispose());
        for (const variant of ['default', 'amiga']) {
            await page.evaluate(async (variant) => {
                const [{ render }, { jsx }, { PauseButton }] = await Promise.all([
                    import('./node_modules/preact/dist/preact.js' as string),
                    import('./node_modules/preact/jsx-runtime/dist/jsxRuntime.js' as string),
                    import('./components/PauseButton/index.js' as string),
                ]);
                // Each appearance starts fresh after the previous imperative click.
                render(null, document.getElementById('app')!);
                render(
                    jsx(PauseButton, {
                        variant,
                        disabled: false,
                        hidden: false,
                        'aria-pressed': 'true',
                        class: 'fixture-pause',
                        onClick: (event: MouseEvent) =>
                            (event.currentTarget as HTMLButtonElement).setAttribute(
                                'aria-pressed',
                                'false',
                            ),
                    }),
                    document.getElementById('app')!,
                );
            }, variant);
            const pause = page.locator('#pause.pause-button.fixture-pause');
            assert.equal(await pause.isVisible(), true);
            assert.equal(await pause.textContent(), 'Pause');
            assert.equal(await pause.getAttribute('type'), 'button');
            const expectedBorder = variant === 'amiga' ? 'rgb(164, 245, 219)' : null;
            const pausedStyle = await pause.evaluate((node) => ({
                border: getComputedStyle(node).borderColor,
                shadow: getComputedStyle(node).boxShadow,
                hovered: node.matches(':hover'),
            }));
            assert.equal(
                pausedStyle.border,
                expectedBorder ||
                    (pausedStyle.hovered ? 'rgb(255, 255, 255)' : 'rgb(231, 235, 222)'),
            );
            assert.equal(pausedStyle.shadow.includes('rgb(164, 245, 219)'), variant === 'amiga');
            if (name !== 'WebKit') {
                await pause.hover();
                assert.equal(
                    await pause.evaluate((node) => getComputedStyle(node).borderColor),
                    expectedBorder || 'rgb(255, 255, 255)',
                    'The paused border remains correct on hover',
                );
            }
            await pause.press('Enter');
            assert.equal(await pause.getAttribute('aria-pressed'), 'false');
            assert.equal(await pause.evaluate((node) => getComputedStyle(node).boxShadow), 'none');
        }
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} shared Modal/Select/Checkbox/Input/PauseButton, native attributes/events, focus trap, restore, Escape, backdrop and empty focus fallback.`,
        );
    } finally {
        await page.close();
    }
}
