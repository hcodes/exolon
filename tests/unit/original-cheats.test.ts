import assert from 'node:assert/strict';
import test from 'node:test';
import { isOriginalNativeCheatName } from '../../src/games/16bit/controllers/preferences.ts';

test('native cheat accepts the original lowercase eight-byte prefix only', () => {
    for (const name of ['ad astra', 'ad astra..', 'ad astraXY'])
        assert.equal(isOriginalNativeCheatName(name), true, name);
    for (const name of ['', 'ad astr', 'AD ASTRA', 'Ad Astra', 'adastra', ' ad astra', 'ZORBA'])
        assert.equal(isOriginalNativeCheatName(name), false, name);
});
