import assert from 'node:assert/strict';
import test from 'node:test';
import { isMobileBrowser } from '../../src/utils/mobile.ts';

test('mobile User-Agents enable phone and tablet controls, including old iOS', () => {
    for (const ua of [
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/130.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X) Mobile/13G36 Safari/601.1',
        'Mozilla/5.0 (iPod touch; CPU iPhone OS 9_3_5 like Mac OS X) Mobile/13G36 Safari/601.1',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Mobile/15E148 Safari/604.1',
        'Browser iOS/18.0',
        'Browser Mobile',
    ])
        assert.equal(isMobileBrowser(ua), true, ua);
});

test('headsets, TVs and desktop browsers do not receive mobile controls', () => {
    for (const ua of [
        'Mozilla/5.0 (Linux; Android 10; Quest 3S) OculusBrowser/34.0 Chrome/130.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 10) OculusBrowser/34.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 10) Chrome/130.0 MobileVR Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64; Quest) Chrome/130.0 Safari/537.36',
        'Mozilla/5.0 (Linux; Android 12; Android TV) Chrome/108.0 Mobile Safari/537.36',
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) TV Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        '',
    ])
        assert.equal(isMobileBrowser(ua), false, ua);
});

test('desktop-style iPad User-Agents need multiple touch points while desktop and VR touch support is insufficient', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15';
    assert.equal(isMobileBrowser(mac, 5), true);
    assert.equal(isMobileBrowser(mac, 1), false);
    assert.equal(isMobileBrowser(mac, 0), false);
    assert.equal(isMobileBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10), false);
    assert.equal(
        isMobileBrowser('Mozilla/5.0 (Linux; Android 10; Quest) OculusBrowser/34.0 Mobile', 5),
        false,
    );
});
