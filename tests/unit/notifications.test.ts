import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifications } from '../../src/controllers/notifications.ts';

test('notifications accept arbitrary messages, replace timers and stop after disposal', () => {
    const element = { hidden: true, textContent: '' };
    const pending = new Map<number, { callback: () => void; duration: number }>();
    let next = 0;
    const notifications = createNotifications(
        element as unknown as HTMLElement,
        {
            setTimeout(callback: () => void, duration: number) {
                pending.set(++next, { callback, duration });
                return next;
            },
            clearTimeout(id: number) {
                pending.delete(id);
            },
        } as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>,
    );
    notifications.show('Settings saved');
    assert.equal(element.textContent, 'Settings saved');
    assert.equal(element.hidden, false);
    assert.equal(pending.get(next)!.duration, 3500);
    notifications.show('Fullscreen unavailable', 6000);
    assert.equal(pending.size, 1);
    assert.equal(pending.get(next)!.duration, 6000);
    assert.equal(element.textContent, 'Fullscreen unavailable');
    pending.get(next)!.callback();
    pending.delete(next);
    assert.equal(element.hidden, true);
    assert.equal(element.textContent, '');
    notifications.show('Saved');
    notifications.clear();
    assert.equal(pending.size, 0);
    notifications.show('Loading complete');
    notifications.destroy();
    assert.equal(pending.size, 0);
    assert.equal(element.hidden, true);
    notifications.show('Late asynchronous result');
    assert.equal(element.hidden, true);
    assert.equal(element.textContent, '');
    assert.equal(pending.size, 0);
});
