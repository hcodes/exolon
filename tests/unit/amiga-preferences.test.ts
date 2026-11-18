import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeAmigaOptions,
    readAmigaRows,
    readAmigaLevel,
} from '../../src/games/amiga/controllers/preferences.ts';

test('Amiga validates persisted options and keeps foreign or malformed records out', () => {
    assert.deepEqual(normalizeAmigaOptions('{'), {});
    assert.deepEqual(
        normalizeAmigaOptions(
            JSON.stringify({ invulnerable: 'true', infiniteAmmo: true, arbitrary: true }),
        ),
        { infiniteAmmo: true },
    );
    assert.deepEqual(readAmigaRows('{'), []);
    assert.deepEqual(
        readAmigaRows(
            JSON.stringify([
                { name: '<script>', score: 123 },
                { name: 'FOO', score: -1 },
                { name: 'NAN', score: '99' },
            ]),
        ),
        [{ name: 'SCRIPT', score: 123 }],
    );
    assert.equal(readAmigaLevel('?game=amiga&level=41'), 40);
    assert.equal(readAmigaLevel('?level=999'), 124);
    assert.equal(readAmigaLevel('?level=-1'), 0);
    assert.equal(readAmigaLevel('?level=NaN'), 0);
});

test('Amiga native local ranking accepts qualifying scores from every run among 34 entries', async () => {
    const { qualifiesAmigaScore, insertAmigaScore } =
        await import('../../src/games/amiga/controllers/preferences.ts');
    const rows = Array.from({ length: 34 }, (_, i) => ({ name: `P${i}`, score: 1000 }));
    for (const score of [0, -1, NaN, Infinity])
        assert.equal(qualifiesAmigaScore(score, rows), false);
    assert.equal(qualifiesAmigaScore(999, rows), false);
    assert.equal(qualifiesAmigaScore(1000, rows), true);
    assert.equal(qualifiesAmigaScore(999999, rows), true);
    const saved = insertAmigaScore(rows, 'HERO', 1000);
    assert.equal(saved.length, 34);
    assert.ok(saved.some((row) => row.name === 'HERO'));
    const cheated = insertAmigaScore(rows, 'CHEAT', 999999);
    assert.equal(cheated.length, 34);
    assert.deepEqual(cheated[0], { name: 'CHEAT', score: 999999 });
    const selected = insertAmigaScore(rows, 'SELECTED', 5000);
    assert.equal(selected.length, 34);
    assert.deepEqual(selected[0], { name: 'SELECTED', score: 5000 });
});
