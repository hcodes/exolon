import assert from 'node:assert/strict';
import test from 'node:test';
import { drawControlMenu } from '../../src/view/control-menu.ts';
import {
    createControlMenu,
    controlEntries,
    controlPlatform,
    controlInput,
} from '../../src/model/control-menu.ts';

test('only original ZORBA definitions signal the cheat after the final release', () => {
    for (const mode of ['retro', 'cpc', 'sharp-mz800', 'c64', 'gameboy', 'gameboy-color']) {
        const menu = createControlMenu();
        menu.activate(mode, 2);
        for (const key of ['Z', 'O', 'R', 'B']) {
            menu.captureKey(`Key${key}`, key.toLowerCase());
            assert.equal(menu.release(`Key${key}`), false);
        }
        menu.captureKey('KeyA', 'a');
        assert.ok(menu.snapshot.definition, 'held final key does not complete the code');
        assert.equal(
            menu.release('KeyA'),
            ['retro', 'cpc', 'sharp-mz800'].includes(mode) ? 'cheat' : true,
            mode,
        );
        assert.equal(menu.release('KeyA'), false, 'one completion per definition');
        assert.deepEqual(
            menu.snapshot.profiles[controlPlatform(mode)].bindings.map((b) => b.label),
            ['Z', 'O', 'R', 'B', 'A'],
        );
    }
});

test('reversed spelling and cancelled definitions cannot signal a cheat', () => {
    const menu = createControlMenu();
    menu.activate('retro', 2);
    for (const key of ['Z', 'O', 'B', 'R']) {
        menu.captureKey(`Key${key}`, key);
        menu.release(`Key${key}`);
    }
    menu.captureKey('KeyA', 'A');
    assert.equal(menu.release('KeyA'), true);
    menu.activate('retro', 2);
    for (const key of ['Z', 'O', 'R', 'B']) {
        menu.captureKey(`Key${key}`, key);
        menu.release(`Key${key}`);
    }
    menu.captureKey('KeyA', 'A');
    menu.cancel();
    assert.equal(menu.release('KeyA'), false);
});

test('source menu choices and defaults stay platform specific', () => {
    const menu = createControlMenu();
    assert.deepEqual(
        controlEntries('retro').map((e) => e.label),
        ['1 START GAME', '2 DEFINE KEYS', '3 KEYBOARD', '4 INTERFACE 2', '5 KEMPSTON'],
    );
    assert.deepEqual(
        controlEntries('c64')
            .slice(3)
            .map((e) => e.label),
        ['4 JOYSTICK PORT 1', '5 JOYSTICK PORT 2'],
    );
    assert.deepEqual(
        controlEntries('cpc').map((e) => [e.label, e.row]),
        [
            ['1 START GAME', 13],
            ['2 DEFINE KEYS', 17],
        ],
    );
    assert.deepEqual(
        controlEntries('sharp-mz800')
            .slice(3)
            .map((e) => e.label),
        ['4 CURSOR', '5 JOYSTICK'],
    );
    assert.equal(menu.snapshot.profiles['sharp-mz800'].device, 1);
    assert.equal(menu.snapshot.profiles.retro.device, 0);
    assert.equal(controlPlatform('remastered'), 'retro');
    assert.equal(controlPlatform('gameboy-color'), 'retro');
    assert.equal(controlInput(menu.snapshot, 'cpc').keys.Space.includes('fire'), true);
});

test('definition waits for release, permits duplicates and commits all five bindings atomically', () => {
    const menu = createControlMenu();
    menu.activate('retro', 5);
    const original = menu.snapshot.profiles.retro.bindings;
    assert.equal(menu.activate('retro', 2), 'changed');
    assert.equal(menu.snapshot.definition?.step, 0);
    menu.captureKey('KeyZ', 'z');
    menu.captureKey('KeyX', 'x');
    assert.equal(menu.snapshot.definition?.step, 0);
    assert.deepEqual(menu.snapshot.profiles.retro.bindings, original);
    menu.release('KeyX');
    assert.equal(menu.snapshot.definition?.step, 0);
    menu.release('KeyZ');
    assert.equal(menu.snapshot.definition?.step, 1);
    for (const code of ['KeyZ', 'KeyW', 'KeyS', 'KeyF']) {
        menu.captureKey(code, code.slice(3));
        menu.release(code);
    }
    assert.equal(menu.snapshot.definition, undefined);
    assert.equal(menu.snapshot.profiles.retro.device, 0);
    const config = controlInput(menu.snapshot, 'retro');
    assert.deepEqual(config.keys.KeyZ, ['left', 'right']);
    assert.deepEqual(config.keys.KeyF, ['fire']);
    assert.equal(config.keys.KeyM, undefined, 'old primary binding is replaced');
});

test('cancel discards partial keys and leaves other platforms unchanged', () => {
    const menu = createControlMenu();
    menu.activate('c64', 5);
    menu.activate('retro', 2);
    menu.captureKey('KeyF', 'f');
    menu.release('KeyF');
    menu.cancel();
    assert.equal(menu.snapshot.profiles.c64.device, 2);
    assert.deepEqual(controlInput(menu.snapshot, 'retro').keys.KeyO, ['left']);
    assert.equal(controlInput(menu.snapshot, 'retro').keys.KeyF, undefined);
    assert.equal(menu.snapshot.definition, undefined);
});

test('every menu device choice preserves current keyboard controls and automatic gamepads', () => {
    const menu = createControlMenu();
    for (const mode of ['retro', 'c64', 'sharp-mz800']) {
        for (const digit of [3, 4, 5]) {
            menu.activate(mode, digit);
            const config = controlInput(menu.snapshot, mode);
            assert.deepEqual(
                config.keys.KeyO,
                ['left'],
                `${mode} option${digit} must keep keyboard movement`,
            );
            assert.deepEqual(config.keys.KeyM, ['fire']);
            assert.deepEqual(
                Object.keys(config),
                ['keys'],
                'historical choices must not impose a gamepad port or remap',
            );
        }
    }
});

test('defined keyboard bindings remain active after switching the displayed input preference', () => {
    const menu = createControlMenu();
    menu.activate('c64', 2);
    for (const code of ['KeyZ', 'KeyX', 'KeyW', 'KeyS', 'KeyF']) {
        menu.captureKey(code, code.slice(3));
        menu.release(code);
    }
    for (const digit of [3, 4, 5]) {
        menu.activate('c64', digit);
        assert.deepEqual(controlInput(menu.snapshot, 'c64').keys.KeyF, ['fire']);
        assert.equal(controlInput(menu.snapshot, 'c64').keys.KeyM, undefined);
    }
});

test('menu navigation wraps within real options; unknown choices cannot start or alter settings', () => {
    const menu = createControlMenu();
    menu.move('cpc', -1);
    assert.equal(menu.snapshot.focus, 1);
    menu.move('cpc', 1);
    assert.equal(menu.snapshot.focus, 0);
    assert.equal(menu.activate('cpc', 3), null);
    assert.equal(menu.activate('cpc', 1), 'start');
});

test('definition waits for all overlapping keys to be released before the next prompt', () => {
    const menu = createControlMenu();
    menu.activate('retro', 2);
    menu.captureKey('KeyZ', 'z');
    menu.captureKey('KeyX', 'x');
    menu.release('KeyZ');
    assert.equal(menu.snapshot.definition?.step, 0, 'X is still held');
    menu.release('KeyX');
    assert.equal(menu.snapshot.definition?.step, 1);
    menu.captureKey('KeyX', 'x');
    menu.release('KeyX');
    assert.equal(menu.snapshot.definition?.step, 2);
});

test('original device names stay in source tiles while selection only overlays cursor and highlight', () => {
    const labels: string[] = [],
        highlights: number[][] = [];
    const menu = createControlMenu();
    menu.activate('c64', 5);
    drawControlMenu('c64', menu.snapshot, {
        clear() {},
        text(value) {
            labels.push(value);
        },
        highlight(row, width) {
            highlights.push([row, width]);
        },
    });
    assert.deepEqual(labels, ['>'], 'source labels must not be replaced with modern device names');
    assert.deepEqual(highlights, [[19, 14]]);
});
