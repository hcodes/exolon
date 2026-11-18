import type { GraphicsMode } from '../types/ui.ts';
import { SCREEN_COUNT } from '../constants/game.ts';
import { GRAPHICS_MODES } from '../constants/graphics.ts';

export function readObject(raw: unknown): Record<string, unknown> {
    try {
        const value = JSON.parse(typeof raw === 'string' ? raw : 'null') as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value))
            return value as Record<string, unknown>;
    } catch {
        /* Invalid or unavailable saved settings use defaults. */
    }
    return {};
}
export function readGraphicsMode(raw: unknown): GraphicsMode {
    return typeof raw === 'string' && GRAPHICS_MODES.includes(raw as GraphicsMode)
        ? (raw as GraphicsMode)
        : 'retro';
}

export function readLaunchOptions(search: string, savedGraphics: unknown) {
    const query = new URLSearchParams(search);
    const level = (query.get('level') || '').trim();
    const value = Number(level);
    const hasLevel = /^\d+$/.test(level) && value >= 1 && value <= SCREEN_COUNT;
    const legacyIndex =
        query.get('debug') === '1'
            ? Math.floor(Math.max(0, Math.min(SCREEN_COUNT - 1, Number(query.get('screen')) || 0)))
            : 0;
    const requested = (query.get('graphics') || '').trim().toLowerCase();
    const graphics = requested === 'zx-spectrum' ? 'retro' : requested;
    return {
        screenIndex: hasLevel ? value - 1 : legacyIndex,
        graphicsMode: GRAPHICS_MODES.includes(graphics as GraphicsMode)
            ? (graphics as GraphicsMode)
            : readGraphicsMode(savedGraphics),
    };
}
