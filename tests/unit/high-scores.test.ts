import assert from 'node:assert/strict';
import test from 'node:test';
import { createScoreController } from '../../src/controllers/scores.ts';
import {
    createHighScoreRows,
    normalizeHighScore,
    createScoreAttract,
} from '../../src/model/high-scores.ts';

import * as scores from '../../src/model/high-scores.ts';
const { normalizePlayerName, readPlayerRecord } = scores;

test('the original fifty 1000-point records retain their order and six-digit scores', () => {
    const rows = createHighScoreRows(0);
    assert.equal(rows.length, 50);
    assert.deepEqual(rows.slice(0, 3), [
        { name: 'RAFFAELE', score: 1000 },
        { name: 'SURYANI', score: 1000 },
        { name: 'SCRAGGY', score: 1000 },
    ]);
    assert.equal(rows.at(-1)!.name, 'HUMPTY');
    assert.ok(rows.every((row) => row.score === 1000));
    assert.ok(!rows.some((row) => row.player));
});

test('a personal best enters above the original records only when it beats 1000', () => {
    assert.equal(createHighScoreRows(1000)[0].name, 'RAFFAELE');
    const rows = createHighScoreRows(1250);
    assert.deepEqual(rows[0], { name: 'PLAYER', score: 1250, player: true });
    assert.equal(rows.length, 50);
    assert.equal(rows[1].name, 'RAFFAELE');
    assert.equal(rows.at(-1)!.name, 'RZASM2');
    for (const value of [null, undefined, 'bad', NaN, Infinity, -20])
        assert.equal(normalizeHighScore(value), 0);
    assert.equal(normalizeHighScore('1250'), 1250);
    assert.equal(normalizeHighScore(1000000), 999999);
});

test('idle title shows Start Game selection before records and returns to the title', () => {
    const attract = createScoreAttract();
    assert.equal(attract.frame(0).page, 'title');
    assert.equal(attract.frame(5999).page, 'title');
    assert.equal(attract.frame(6000).page, 'menu');
    assert.equal(attract.frame(11999).page, 'menu');
    assert.equal(attract.frame(12000).page, 'scores');
    assert.equal(attract.frame(14500).offset, 0);
    assert.equal(attract.frame(15200).offset, 1);
    assert.equal(attract.frame(45300).offset, 44);
    assert.equal(attract.frame(47800).page, 'title');
});

test('a title without control selection keeps the twelve-second lead-in to records', () => {
    const attract = createScoreAttract();
    assert.equal(attract.frame(0, true, false).page, 'title');
    assert.equal(attract.frame(6000, true, false).page, 'title');
    assert.equal(attract.frame(11999, true, false).page, 'title');
    assert.equal(attract.frame(12000, true, false).page, 'scores');
    assert.equal(attract.frame(47800, true, false).page, 'title');
});

test('removing control selection while it is open returns to a fresh title', () => {
    const attract = createScoreAttract();
    attract.frame(0);
    assert.equal(attract.frame(6000).page, 'menu');
    assert.equal(attract.frame(7000, true, false).page, 'title');
    assert.equal(attract.frame(18999, true, false).page, 'title');
    assert.equal(attract.frame(19000, true, false).page, 'scores');
});

test('activity postpones the records and gameplay/hidden time cannot advance the menu', () => {
    const attract = createScoreAttract();
    attract.frame(0);
    attract.frame(5000);
    attract.activity();
    attract.frame(6000);
    assert.equal(attract.frame(11999).page, 'title');
    assert.equal(attract.frame(12000).page, 'menu');
    attract.frame(16000);
    attract.activity();
    attract.frame(17000);
    assert.equal(attract.frame(22999).page, 'menu', 'Activity keeps the selection screen open');
    attract.suspend();
    assert.equal(attract.frame(100000).page, 'menu');
    assert.equal(attract.frame(100001).page, 'scores');
    attract.showScores();
    attract.frame(102000);
    attract.frame(103000, false);
    assert.equal(attract.frame(203000).offset, 0);
    attract.reset();
    assert.equal(attract.frame(204000).page, 'title');
});

test('player names fit the eight-character source font and replace PLAYER in the personal record', () => {
    assert.deepEqual(createHighScoreRows(2500, 'ace')[0], {
        name: 'ACE',
        score: 2500,
        player: true,
    });
    assert.equal(normalizePlayerName('  ace-7!  '), 'ACE-7!');
    assert.equal(normalizePlayerName('abcdefghijk'), 'ABCDEFGH');
    assert.equal(normalizePlayerName('💥'), 'PLAYER');
});
test('saved names attach only to their matching best score, while last nickname survives migration', () => {
    assert.deepEqual(readPlayerRecord(null, 2500), { name: 'PLAYER', playerName: 'PLAYER' });
    assert.deepEqual(readPlayerRecord('{broken', 2500), { name: 'PLAYER', playerName: 'PLAYER' });
    const raw = JSON.stringify({ score: 2500, name: 'ace', playerName: 'new' });
    assert.deepEqual(readPlayerRecord(raw, 2500), { name: 'ACE', playerName: 'NEW' });
    assert.deepEqual(readPlayerRecord(raw, 3000), { name: 'PLAYER', playerName: 'NEW' });
    assert.deepEqual(readPlayerRecord('null', 2500), { name: 'PLAYER', playerName: 'PLAYER' });
});

test('international player names retain letters and accents through score persistence', () => {
    for (const [input, expected] of [
        ['жук', 'ЖУК'],
        ['ёжик', 'ЁЖИК'],
        ['élodie', 'ÉLODIE'],
        ['王小明', '王小明'],
        ['أحمد', 'أحمد'],
        ['μαρία', 'ΜΑΡΊΑ'],
        ['A\u0301lex', 'ÁLEX'],
    ]) {
        assert.equal(normalizePlayerName(input), expected);
        const table = scores.insertHighScore(createHighScoreRows(0), input, 5000);
        assert.equal(table[0].name, expected);
        assert.deepEqual(scores.readHighScoreTable(JSON.stringify(table)), table);
        assert.deepEqual(
            readPlayerRecord(JSON.stringify({ score: 5000, name: input, playerName: input }), 5000),
            { name: expected, playerName: expected },
        );
    }
    assert.equal(normalizePlayerName('ёжик-123456'), 'ЁЖИК-123');
    assert.equal(normalizePlayerName('Ж\nУ\tК💥'), 'ЖУК');
});

test('the leaderboard retains several named results in descending order without changing older names', () => {
    const original = createHighScoreRows(0);
    let table = scores.insertHighScore(original, 'alice', 5000);
    table = scores.insertHighScore(table, 'bob', 3000);
    table = scores.insertHighScore(table, 'carol', 6000);
    assert.deepEqual(table.slice(0, 3), [
        { name: 'CAROL', score: 6000, player: true },
        { name: 'ALICE', score: 5000, player: true },
        { name: 'BOB', score: 3000, player: true },
    ]);
    assert.equal(table.length, 50);
    assert.equal(original[0].name, 'RAFFAELE');
    assert.deepEqual(scores.readHighScoreTable(JSON.stringify(table), 6000, 'CAROL'), table);
});

test('leaderboard migration keeps legacy best and source names while malformed rows fall back safely', () => {
    const migrated = scores.readHighScoreTable(null, 2500, 'ace');
    assert.deepEqual(migrated[0], { name: 'ACE', score: 2500, player: true });
    assert.deepEqual(scores.readHighScoreTable('{bad', 2500, 'ace'), migrated);
    const partial = scores.readHighScoreTable(
        JSON.stringify([{ name: 'BOB', score: 3000, player: true }, null, { name: '', score: -1 }]),
    );
    assert.equal(partial.length, 50);
    assert.equal(partial[0].name, 'BOB');
    assert.ok(partial.some((row) => row.name === '*!/?!@'));
    assert.deepEqual(scores.readHighScoreTable(JSON.stringify(migrated), 2500, 'ace'), migrated);
});

test('equal scores keep arrival order, repeated names are separate attempts and unranked scores stay out', () => {
    const original = createHighScoreRows(0);
    assert.equal(scores.insertHighScore(original, 'LOW', 1000), original);
    let table = scores.insertHighScore(original, 'ALICE', 5000);
    table = scores.insertHighScore(table, 'BOB', 5000);
    table = scores.insertHighScore(table, 'ALICE', 4000);
    assert.deepEqual(
        table.slice(0, 3).map((row) => [row.name, row.score]),
        [
            ['ALICE', 5000],
            ['BOB', 5000],
            ['ALICE', 4000],
        ],
    );
    for (let i = 0; i < 60; i++) table = scores.insertHighScore(table, 'ACE', 10000 + i);
    assert.equal(table.length, 50);
    assert.equal(table[0].score, 10059);
    assert.equal(table.at(-1)!.score, 10010);
    assert.equal(scores.insertHighScore(table, 'LOW', 1500), table);
});

test('local rankings retain cheated scores and personal bests after reload', () => {
    const values = new Map<string, string>();
    const storage = {
        get: (key: string) => values.get(key) ?? null,
        set(key: string, value: unknown) {
            values.set(key, String(value));
            return true;
        },
    };
    const records = createScoreController(storage);
    records.save({ score: 5000, cheatUsed: true });
    assert.equal(records.lastScore, 5000);
    assert.equal(records.bestScore, 5000);
    assert.equal(records.submit('CHEATER', { score: 5000, cheatUsed: true }), true);
    const restored = createScoreController(storage);
    assert.equal(restored.bestScore, 5000);
    assert.deepEqual(restored.rows[0], { name: 'CHEATER', score: 5000, player: true });
    assert.equal(restored.rows.length, 50);
});
