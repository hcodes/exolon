import type { NativeOptions } from '../types/index.ts';

export function isOriginalNativeCheatName(name: string) {
    return name.slice(0, 8) === 'ad astra';
}
function parse(raw: unknown): unknown {
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return undefined;
    }
}
export function normalizeNativeOptions(raw: unknown): NativeOptions {
    const parsed = parse(raw);
    const result: NativeOptions = {};
    if (!parsed || typeof parsed !== 'object') return result;
    for (const key of [
        'invulnerable',
        'infiniteLives',
        'infiniteAmmo',
        'infiniteGrenades',
        'levelSelection',
        'restartSameLevel',
    ] as const)
        if ((parsed as Record<string, unknown>)[key] === true) result[key] = true;
    return result;
}
export function readNativeRows(
    raw: unknown,
    asciiNames = false,
): { name: string; score: number }[] {
    const parsed = parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter(
            (row): row is { name: string; score: number } =>
                row &&
                typeof row === 'object' &&
                typeof row.name === 'string' &&
                typeof row.score === 'number' &&
                Number.isFinite(row.score) &&
                row.score >= 0,
        )
        .slice(0, 100)
        .map((row) => ({
            name:
                (asciiNames ? row.name : row.name.toUpperCase())
                    .replace(asciiNames ? /[^\x20-\x7e]/g : /[^A-Z0-9. ]/g, '')
                    .slice(0, 10) || 'PLAYER',
            score: Math.min(999999, Math.floor(row.score)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 34);
}
export function readNativeLevel(search: string) {
    const value = new URLSearchParams(search).get('level') || '';
    return /^\d+$/.test(value) ? Math.max(0, Math.min(124, Number(value) - 1)) : 0;
}

export function qualifiesNativeScore(score: number, rows: readonly { score: number }[]) {
    return Number.isFinite(score) && score > 0 && (rows.length < 34 || score >= rows[33].score);
}
export function insertNativeScore(
    rows: readonly { name: string; score: number }[],
    name: string,
    score: number,
) {
    if (!qualifiesNativeScore(score, rows)) return [...rows];
    return [{ name, score: Math.min(999999, Math.floor(score)) }, ...rows]
        .sort((a, b) => b.score - a.score)
        .slice(0, 34);
}
