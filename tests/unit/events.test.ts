import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventScope } from '../../src/lib/events.ts';

test('legacy media query changes reach subscribers only while the event scope is alive', () => {
    const listeners = new Set<EventListener>();
    // Safari before 14 has addListener/removeListener without EventTarget methods.
    const query = {
        addListener(listener: EventListener) {
            listeners.add(listener);
        },
        removeListener(listener: EventListener) {
            listeners.delete(listener);
        },
    } as unknown as MediaQueryList;
    const events = createEventScope(undefined);
    let changes = 0;
    function handleChange() {
        changes++;
    }
    function change() {
        for (const listener of listeners) listener(new Event('change'));
    }
    events.on(query, 'change', handleChange);
    change();
    assert.equal(changes, 1, 'A live reduced-motion change reaches its controller');
    events.destroy();
    change();
    assert.equal(changes, 1, 'Disposal removes legacy media query listeners');
});
