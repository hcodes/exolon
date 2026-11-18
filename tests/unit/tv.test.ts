import test from 'node:test';
import assert from 'node:assert/strict';
import { isTvBrowser, tvKey } from '../../src/utils/tv.ts';
import { createInput } from '../../src/input/index.ts';

test('TV detection recognises TV browsers without classifying mobile or desktop as televisions', () => {
    for (const ua of [
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 TV Safari/537.36',
        'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88 Safari/537.36',
        'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2) AppleWebKit/537.36 Chrome/108.0 Safari/537.36',
        'Mozilla/5.0 (Linux; Android 12; Android TV) Chrome/108.0 Safari/537.36',
        'Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 Chrome/77.0.3865.65 Safari/537.36 Hisense',
        'Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 Chrome/77.0.3865.65 Safari/537.36 VIDAA/4.0',
    ])
        assert.equal(isTvBrowser(ua), true, ua);
    for (const ua of [
        'Chrome desktop',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile',
        'iPad',
        'Tizen Mobile',
        'Mozilla/5.0 (Linux; Android 9; Hisense U30) AppleWebKit/537.36 Chrome/77.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 4.2; Hisense Sero 7 Pro) AppleWebKit/537.36 Safari/537.36',
    ]) {
        assert.equal(isTvBrowser(ua), false, ua);
    }
    assert.equal(isTvBrowser('SmartTV'), true);
    assert.equal(isTvBrowser(''), false);
});

test('remote keys normalise standard DOM keys and vendor codes, leaving browser/system keys alone', () => {
    for (const [keyCode, expected] of [
        [37, 'ArrowLeft'],
        [38, 'ArrowUp'],
        [39, 'ArrowRight'],
        [40, 'ArrowDown'],
        [13, 'Enter'],
        [461, 'Back'],
        [10009, 'Back'],
        [27, 'Back'],
        [19, 'Pause'],
        [415, 'Pause'],
        [10252, 'Pause'],
    ] as const) {
        assert.equal(tvKey({ keyCode, code: 'Unidentified' }), expected);
    }
    assert.equal(tvKey({ key: 'BrowserBack' }), 'Back');
    assert.equal(tvKey({ code: 'ArrowUp' }), 'ArrowUp');
    assert.equal(tvKey({ key: 'Enter' }), 'Enter');
    assert.equal(tvKey({ key: 'MediaPlayPause' }), 'Pause');
    for (const keyCode of [8, 447, 448, 449, 10182, 0]) assert.equal(tvKey({ keyCode }), null);
});

test('TV number buttons normalise modern, numpad and legacy events without enabling desktop shortcuts', () => {
    for (const [digit, keyCode, numpadCode, expected] of [
        ['2', 50, 98, 'ArrowUp'],
        ['4', 52, 100, 'ArrowLeft'],
        ['5', 53, 101, 'Enter'],
        ['6', 54, 102, 'ArrowRight'],
        ['8', 56, 104, 'ArrowDown'],
    ] as const) {
        for (const event of [
            { key: digit },
            { code: `Digit${digit}` },
            { code: `Numpad${digit}` },
            { keyCode, code: 'Unidentified' },
            { which: numpadCode },
        ]) {
            assert.equal(tvKey(event), expected, JSON.stringify(event));
            assert.equal(tvKey(event, false), null, 'Number shortcuts are TV-only');
        }
    }
    assert.equal(tvKey({ code: 'ArrowLeft' }, false), 'ArrowLeft');
    for (const key of ['0', '1', '3', '7', '9']) assert.equal(tvKey({ key }), null);
});

test('remote commands survive sampling, preserve quick taps, and reset without stuck fire', () => {
    const target = Object.assign(new EventTarget(), { navigator: {} });
    const controls = Object.assign(new EventTarget(), { querySelectorAll: () => [] });
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    try {
        input.setRemoteCommand('right', true);
        input.setRemoteCommand('fire', true);
        assert.equal(input.sample().right, true);
        assert.equal(input.sample().fire, true);
        input.setRemoteCommand('fire', false);
        assert.equal(input.sample().fire, false);
        input.setRemoteCommand('fire', true);
        input.setRemoteCommand('fire', false);
        assert.equal(input.sample().fire, true);
        assert.equal(input.sample().fire, false);
        input.reset();
        assert.equal(input.sample().right, false);
        input.setRemoteCommand('fire', true);
        target.dispatchEvent(new Event('blur'));
        assert.equal(input.sample().fire, false);
        input.setRemoteCommand('fire', false);
        assert.equal(input.sample().fire, false);
    } finally {
        input.destroy();
    }
});
