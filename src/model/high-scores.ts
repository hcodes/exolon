// Original names/order: menu_highscore.asm, Raffaele Cecco / Sergey Erokhin,
// CC BY-SA 3.0. Personal-best storage and wall-clock presentation are new JS.
const ORIGINAL_NAMES = [
    'RAFFAELE',
    'SURYANI',
    'SCRAGGY',
    'SABATTA!',
    'PADDY',
    'LOFTY',
    'JIMBO',
    'LEO',
    'GLEN',
    'MORANGE',
    'PUPPY',
    'ONION',
    'RIP',
    'FIGARO',
    'INK',
    'PEN',
    'DUMBO',
    'MEPHISTO',
    'QUEEN',
    'UNYIL ?',
    'EQUINOX',
    'REALMS',
    'MAJALA',
    'LENGKAP',
    'JAZZ',
    'HEWSON',
    'TIM.M',
    'CECCO',
    'LUCY',
    'ANTONY',
    'NIAEREH',
    '*!/?!@',
    'POD',
    'HUTNEE',
    'BUTNEE',
    'JOHN.O',
    'CARROT',
    'COLIN',
    'FLASH',
    'SEVILLE',
    'T-STATE',
    'CLUB',
    'HWP',
    'CDP',
    'TACHYON',
    'KILLER',
    'DROOPY',
    'R 4 S',
    'RZASM2',
    'HUMPTY',
];

export interface HighScoreRow {
    name: string;
    score: number;
    player?: boolean;
}
export interface PlayerRecord {
    name: string;
    playerName: string;
}
export type AttractPage = 'title' | 'menu' | 'scores';
export interface AttractSnapshot {
    page: AttractPage;
    offset: number;
}
export interface ScoreAttract {
    frame(now: number, active?: boolean, controls?: boolean): AttractSnapshot;
    activity(): void;
    suspend(): void;
    showScores(): AttractSnapshot;
    showMenu(): AttractSnapshot;
    reset(): AttractSnapshot;
}

function readStoredJson(raw: unknown): unknown {
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function normalizeHighScore(value: unknown): number {
    const score = Number(value);
    return Number.isFinite(score) ? Math.floor(Math.max(0, Math.min(999999, score))) : 0;
}

export function normalizePlayerName(value: unknown, fallback = 'PLAYER'): string {
    return (
        (typeof value === 'string'
            ? Array.from(
                  (value.normalize?.('NFC') ?? value)
                      .toUpperCase()
                      .replace(/[^\p{L}\p{M}\p{N} .!?'-]/gu, '')
                      .trim(),
              )
                  .slice(0, 8)
                  .join('')
            : '') || fallback
    );
}

export function readPlayerRecord(raw: unknown, best: unknown): PlayerRecord {
    const parsed = readStoredJson(raw);
    const record = isRecord(parsed) ? parsed : undefined;
    return {
        name:
            record && Number.isFinite(record.score) && record.score === normalizeHighScore(best)
                ? normalizePlayerName(record.name)
                : 'PLAYER',
        playerName: normalizePlayerName(record?.playerName),
    };
}

export function createHighScoreRows(best: unknown, name = 'PLAYER'): HighScoreRow[] {
    const rows: HighScoreRow[] = ORIGINAL_NAMES.map((name) => ({ name, score: 1000 }));
    const score = normalizeHighScore(best);
    if (score > 1000) rows.unshift({ name: normalizePlayerName(name), score, player: true });
    return rows.slice(0, 50);
}

export function insertHighScore(
    rows: HighScoreRow[],
    name: string,
    value: unknown,
): HighScoreRow[] {
    const score = normalizeHighScore(value),
        index = rows.findIndex((row) => score > row.score);
    if (index < 0) return rows;
    return [
        ...rows.slice(0, index),
        { name: normalizePlayerName(name), score, player: true },
        ...rows.slice(index),
    ].slice(0, 50);
}

export function readHighScoreTable(
    raw: unknown,
    best: unknown = 0,
    name = 'PLAYER',
): HighScoreRow[] {
    const parsed = readStoredJson(raw);
    const rows: HighScoreRow[] = [];
    for (const row of Array.isArray(parsed) ? parsed.slice(0, 50) : []) {
        if (
            !isRecord(row) ||
            typeof row.name !== 'string' ||
            typeof row.score !== 'number' ||
            !Number.isInteger(row.score) ||
            row.score < 0 ||
            row.score > 999999
        )
            continue;
        const label = (row.name.normalize?.('NFC') ?? row.name).toUpperCase().trim();
        if (Array.from(label).length > 8 || !/^[ -Z\p{L}\p{M}\p{N}]+$/u.test(label)) continue;
        rows.push({
            name: label,
            score: row.score,
            ...(row.player === true ? { player: true } : {}),
        });
    }
    for (const original of createHighScoreRows(0)) {
        if (!rows.some((row) => !row.player && row.name === original.name)) rows.push(original);
    }
    const table = rows.sort((a, b) => b.score - a.score).slice(0, 50);
    return normalizeHighScore(best) > table[0].score ? insertHighScore(table, name, best) : table;
}

export function createScoreAttract(): ScoreAttract {
    let page: AttractPage = 'title',
        elapsed = 0;
    let previousTime: number | null = null;
    const snapshot = (): AttractSnapshot => ({
        page,
        offset: page === 'scores' ? Math.max(0, Math.min(44, (elapsed - 2500) / 700)) : 0,
    });
    function reset(next: AttractPage = 'title') {
        page = next;
        elapsed = 0;
        previousTime = null;
        return snapshot();
    }
    return {
        frame(now: number, active = true, controls = true) {
            if (!controls && page === 'menu') reset();
            if (!active) {
                previousTime = null;
                return snapshot();
            }
            if (previousTime !== null) elapsed += Math.max(0, now - previousTime);
            previousTime = now;
            // Keep the twelve-second lead-in to records, optionally passing
            // through the platform's control-selection screen.
            elapsed %= 47800;
            const duration = { title: controls ? 6000 : 12000, menu: 6000, scores: 35800 };
            while (elapsed >= duration[page]) {
                elapsed -= duration[page];
                if (page === 'title') page = controls ? 'menu' : 'scores';
                else page = page === 'menu' ? 'scores' : 'title';
            }
            return snapshot();
        },
        activity() {
            if (page !== 'scores') reset(page);
        },
        suspend() {
            previousTime = null;
        },
        showScores() {
            return reset('scores');
        },
        showMenu() {
            return reset('menu');
        },
        reset() {
            return reset();
        },
    };
}
