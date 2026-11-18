import assert from 'node:assert/strict';
import test from 'node:test';
import { createCheatSettingsControl } from '../../src/controllers/cheat-settings.ts';
import { createEventScope } from '../../src/lib/events.ts';
import type { Cheats } from '../../src/types/game.ts';

const empty: Cheats = {
    infiniteLives: false,
    infiniteRockets: false,
    infiniteAmmo: false,
    invulnerable: false,
    levelSelection: false,
    retryLevel: false,
};
function fixture(options: Cheats = empty) {
    const fields = Object.keys(empty).map((cheat) =>
        Object.assign(new EventTarget(), { dataset: { cheat }, checked: false, disabled: false }),
    );
    const group = { querySelectorAll: () => fields };
    const document = { getElementById: () => group } as unknown as Document;
    const events = createEventScope(null);
    const changes: Cheats[] = [];
    const control = createCheatSettingsControl({
        document,
        events,
        options,
        onChange: (next) => changes.push(next),
    });
    return { fields, events, changes, control };
}

test('cheat settings restore all six options and ignore changes until the game is ready', () => {
    const options = { ...empty, infiniteLives: true, retryLevel: true };
    const f = fixture(options);
    assert.equal(f.fields.length, 6);
    for (const field of f.fields) {
        assert.equal(field.checked, options[field.dataset.cheat as keyof Cheats]);
        assert.equal(field.disabled, true);
        field.dispatchEvent(new Event('change'));
    }
    assert.deepEqual(f.changes, []);
    f.events.destroy();
});

test('each enabled checkbox applies immediately and preserves every other option', () => {
    const f = fixture();
    f.control.setEnabled(true);
    for (let index = 0; index < f.fields.length; index++) {
        const field = f.fields[index]!;
        assert.equal(field.disabled, false);
        field.checked = true;
        field.dispatchEvent(new Event('change'));
        assert.equal(f.changes.length, index + 1);
        assert.deepEqual(
            f.changes[index],
            Object.fromEntries(f.fields.map((item, other) => [item.dataset.cheat, other <= index])),
        );
    }
    assert.equal(f.changes[0]!.retryLevel, false, 'later changes cannot mutate earlier snapshots');
    f.events.destroy();
    f.fields[0]!.checked = false;
    f.fields[0]!.dispatchEvent(new Event('change'));
    assert.equal(f.changes.length, 6, 'disposing the event scope removes change listeners');
});

test('external cheat activation synchronizes checkboxes silently and disabling prevents changes', () => {
    const f = fixture();
    f.control.setEnabled(true);
    f.control.update({ ...empty, infiniteAmmo: true, levelSelection: true });
    assert.deepEqual(
        f.fields.map((field) => field.checked),
        [false, false, true, false, true, false],
    );
    assert.deepEqual(f.changes, []);
    const field = f.fields[0]!;
    field.checked = true;
    field.dispatchEvent(new Event('change'));
    assert.deepEqual(f.changes, [
        { ...empty, infiniteLives: true, infiniteAmmo: true, levelSelection: true },
    ]);
    f.control.setEnabled(false);
    assert.ok(f.fields.every((item) => item.disabled));
    field.checked = false;
    field.dispatchEvent(new Event('change'));
    assert.equal(f.changes.length, 1);
    f.events.destroy();
});
