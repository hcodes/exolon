import { GRAPHICS_MODES } from '../constants/graphics.ts';
const styles: readonly string[] = GRAPHICS_MODES.filter((mode) => mode !== 'split');

// Keep a valid desired platform even while its optional artwork is unavailable.
export function readSplitPair(raw: string | null | undefined) {
    let pair: { left?: unknown; right?: unknown } | undefined;
    try {
        pair = JSON.parse(raw || '');
    } catch {
        /* Ignore malformed or unavailable storage. */
    }
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) pair = {};
    return {
        left: typeof pair.left === 'string' && styles.includes(pair.left) ? pair.left : 'retro',
        right:
            typeof pair.right === 'string' && styles.includes(pair.right)
                ? pair.right
                : 'remastered',
    };
}
