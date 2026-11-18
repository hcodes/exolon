import type { PreferenceStore } from '../types/ui.ts';
import type { GameState } from '../types/game.ts';
type ScoreState = Pick<GameState, 'score'> & Partial<Pick<GameState, 'cheatUsed'>>;
import {
    readHighScoreTable,
    insertHighScore,
    normalizeHighScore,
    normalizePlayerName,
    readPlayerRecord,
} from '../model/high-scores.ts';

// Persistence is injected so records do not depend on the DOM or browser APIs.
export function createScoreController(storage: PreferenceStore) {
    let bestScore = normalizeHighScore(storage.get('bestScore'));
    const saved = readPlayerRecord(storage.get('playerRecord'), bestScore);
    let playerName = saved.playerName,
        bestName = saved.name,
        lastScore = 0;
    let table = readHighScoreTable(storage.get('highScores'), bestScore, bestName);
    function adoptTableBest() {
        const record = table.find((row) => row.player);
        if (record && record.score >= bestScore) {
            bestScore = record.score;
            bestName = record.name;
        }
    }
    function storeRecord() {
        storage.set(
            'playerRecord',
            JSON.stringify({ score: bestScore, name: bestName, playerName }),
        );
    }
    adoptTableBest();
    let tableStored = storage.set('highScores', JSON.stringify(table));
    return {
        get bestScore() {
            return bestScore;
        },
        get playerName() {
            return playerName;
        },
        get lastScore() {
            return lastScore;
        },
        get rows() {
            return bestScore > table[0].score ? insertHighScore(table, bestName, bestScore) : table;
        },
        save(state?: ScoreState | null) {
            lastScore = normalizeHighScore(state?.score);
            if (lastScore > bestScore) {
                bestScore = lastScore;
                bestName = playerName;
                storeRecord();
                storage.set('bestScore', bestScore);
            }
        },
        submit(candidate: unknown, state: ScoreState) {
            playerName = normalizePlayerName(candidate);
            if (state.score > 0 && state.score === bestScore) bestName = playerName;
            const latest = tableStored ? storage.get('highScores') : null;
            if (latest) table = readHighScoreTable(latest);
            table = insertHighScore(table, playerName, state.score);
            adoptTableBest();
            tableStored = storage.set('highScores', JSON.stringify(table));
            storeRecord();
            storage.set('bestScore', bestScore);
            return tableStored;
        },
    };
}
