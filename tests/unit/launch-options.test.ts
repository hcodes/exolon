import test from 'node:test';
import assert from 'node:assert/strict';
import { readLaunchOptions } from '../../src/utils/settings.ts';

test('public level query is one-based across all 125 screens and needs no debug flag', () => {
    for (const level of [1, 2, 25, 26, 41, 75, 125]) {
        assert.equal(readLaunchOptions('?level=' + level, 'retro').screenIndex, level - 1);
    }
    assert.equal(readLaunchOptions('?level=041', 'retro').screenIndex, 40);
});

test('invalid public levels use the ordinary first screen', () => {
    for (const value of [
        '',
        '0',
        '-1',
        '126',
        '9999999999999999999999999',
        'NaN',
        'Infinity',
        '2.5',
        '1e2',
        '0x10',
        'oops',
    ]) {
        assert.equal(
            readLaunchOptions('?level=' + encodeURIComponent(value), 'retro').screenIndex,
            0,
            value,
        );
    }
});

test('graphics query selects every supported mode, with ZX Spectrum naming and case normalization', () => {
    for (const mode of [
        'retro',
        'remastered',
        'c64',
        'cpc',
        'sharp-mz800',
        'gameboy',
        'gameboy-color',
        'split',
    ]) {
        assert.equal(readLaunchOptions('?graphics=' + mode, 'retro').graphicsMode, mode);
    }
    assert.equal(readLaunchOptions('?graphics=zx-spectrum', 'remastered').graphicsMode, 'retro');
    assert.equal(readLaunchOptions('?graphics=Remastered', 'c64').graphicsMode, 'remastered');
});

test('absent or invalid graphics preserve the saved preference, with a safe default for invalid storage', () => {
    for (const query of ['', '?graphics=', '?graphics=unknown', '?graphics=%3Cscript%3E']) {
        assert.equal(readLaunchOptions(query, 'gameboy-color').graphicsMode, 'gameboy-color');
        assert.equal(readLaunchOptions(query, null).graphicsMode, 'retro');
    }
});

test('existing zero-based debug screen links retain their semantics and valid level takes priority', () => {
    assert.equal(readLaunchOptions('?debug=1&screen=25', 'retro').screenIndex, 25);
    assert.equal(readLaunchOptions('?screen=25', 'retro').screenIndex, 0);
    assert.equal(readLaunchOptions('?level=41&debug=1&screen=25', 'retro').screenIndex, 40);
    assert.equal(readLaunchOptions('?debug=1&screen=999', 'retro').screenIndex, 124);
    assert.deepEqual(readLaunchOptions('?level=125&graphics=cpc', 'c64'), {
        screenIndex: 124,
        graphicsMode: 'cpc',
    });
});
