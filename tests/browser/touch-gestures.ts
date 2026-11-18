import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// Desktop engines cannot show the iOS loupe. Verify that native Touch Events
// are canceled even with Pointer Events available and a second finger in use.
export async function checkTouchGestures(page: Page) {
    const result = await page.evaluate(() => {
        const stick = document.querySelector<HTMLElement>('[data-stick]')!;
        const button = document.getElementById('settings-toggle') as HTMLButtonElement;
        const panel = document.getElementById('settings-panel')!;
        const gear = button.querySelector('svg')!;
        const bounds = stick.getBoundingClientRect();
        const held = {
            identifier: 71,
            target: stick as Element,
            clientX: bounds.right - 20,
            clientY: bounds.top + bounds.height / 2,
        };
        const b = button.getBoundingClientRect();
        const tap = {
            identifier: 72,
            target: gear,
            clientX: b.left + b.width / 2,
            clientY: b.top + b.height / 2,
        };
        function touch(type: string, point: typeof held, touches: (typeof held)[]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
                changedTouches: { value: [point] },
                touches: { value: touches },
                targetTouches: { value: touches.filter((p) => p.target === point.target) },
            });
            point.target.dispatchEvent(event);
            return event.defaultPrevented;
        }
        if (window.PointerEvent)
            stick.dispatchEvent(
                new PointerEvent('pointerdown', {
                    pointerId: 73,
                    pointerType: 'touch',
                    clientX: held.clientX,
                    clientY: held.clientY,
                    bubbles: true,
                    cancelable: true,
                }),
            );
        const start = touch('touchstart', held, [held]);
        const taps = [];
        let clicks = 0;
        function countClick() {
            clicks++;
        }
        button.addEventListener('click', countClick);
        for (let i = 0; i < 2; i++) {
            const down = touch('touchstart', tap, [held, tap]);
            const up = touch('touchend', tap, [held]);
            taps.push({ down, up, open: !panel.hidden });
        }
        // Opening Settings clears input state; the original finger is still down.
        const move = touch('touchmove', held, [held]);
        const end = touch('touchend', held, []);
        const context = new Event('contextmenu', { bubbles: true, cancelable: true });
        stick.dispatchEvent(context);
        touch('touchstart', tap, [tap]);
        touch('touchmove', { ...tap, clientX: tap.clientX - 30 }, [tap]);
        touch('touchend', tap, []);
        const dragOpened = !panel.hidden;
        touch('touchstart', tap, [tap]);
        touch('touchcancel', tap, []);
        touch('touchend', tap, []);
        const cancelOpened = !panel.hidden;
        button.removeEventListener('click', countClick);
        if (window.PointerEvent)
            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 73 }));
        return {
            start,
            move,
            end,
            context: context.defaultPrevented,
            taps,
            clicks,
            dragOpened,
            cancelOpened,
        };
    });
    assert.equal(result.start, true, 'Stick Touch Events must block native long-press gestures');
    assert.equal(result.move, true, 'Held touch stays protected after Settings resets input');
    assert.equal(result.end, true, 'Stick release must not become a native tap');
    assert.equal(result.context, true, 'Stick must suppress native context menus');
    assert.deepEqual(result.taps, [
        { down: true, up: true, open: true },
        { down: true, up: true, open: false },
    ]);
    assert.equal(result.clicks, 2, 'Two second-finger taps activate Settings once each');
    assert.equal(result.dragOpened, false, 'Dragging off and back must not toggle Settings');
    assert.equal(result.cancelOpened, false, 'Canceled touches must not toggle Settings');
    await page.locator('#settings-toggle').tap();
    assert.equal(await page.locator('#settings-panel').isVisible(), true);
    await page.locator('#settings-close').tap();
    assert.equal(await page.locator('#settings-panel').isHidden(), true);
}
