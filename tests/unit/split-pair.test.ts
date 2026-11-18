import assert from 'node:assert/strict';
import test from 'node:test';
import { readSplitPair } from '../../src/utils/split-pair.ts';

test('Split pair restores each actual style, including equal sides and optional platforms', () => {
    for (const style of [
        'retro',
        'remastered',
        'c64',
        'cpc',
        'sharp-mz800',
        'gameboy',
        'gameboy-color',
    ]) {
        assert.deepEqual(readSplitPair(JSON.stringify({ left: style, right: style })), {
            left: style,
            right: style,
        });
    }
});

test('Split pair defaults malformed storage and validates the two panes independently', () => {
    for (const raw of [null, undefined, '', '{', 'null', '42', '[]', '"retro"']) {
        assert.deepEqual(readSplitPair(raw), { left: 'retro', right: 'remastered' });
    }
    assert.deepEqual(readSplitPair('{"left":"split","right":"c64"}'), {
        left: 'retro',
        right: 'c64',
    });
    assert.deepEqual(readSplitPair('{"left":"gameboy-color","right":"unknown"}'), {
        left: 'gameboy-color',
        right: 'remastered',
    });
    assert.deepEqual(readSplitPair('{"left":true}'), { left: 'retro', right: 'remastered' });
});

test('Default pair is a fresh value and cannot corrupt subsequent preferences', () => {
    const pair = readSplitPair(null);
    pair.left = 'cpc';
    assert.deepEqual(readSplitPair(null), { left: 'retro', right: 'remastered' });
});
