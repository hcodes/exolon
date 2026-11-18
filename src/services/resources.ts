import { versionAssetUrl } from './asset-url.ts';
import { GRAPHICS_ASSETS } from '../constants/assets.ts';
import type { World } from '../types/game.ts';
import type { Graphics } from '../types/graphics.ts';
import { OPTIONAL_GRAPHICS } from '../constants/graphics.ts';

// Requests are document-relative in both native and legacy builds. Optional
// platforms start only when selected and share their request across consumers.
export async function loadGameResources(
    fetcher = fetch,
    request?: RequestInit,
    initialModes: readonly string[] = [],
) {
    const optional = Object.fromEntries(
        OPTIONAL_GRAPHICS.map(([mode]) => {
            let loading: Promise<unknown | null> | undefined;
            return [
                mode,
                () =>
                    (loading ??= (async () => {
                        try {
                            const response = await fetcher(
                                versionAssetUrl(GRAPHICS_ASSETS[mode]),
                                request,
                            );
                            return response.ok ? await response.json() : null;
                        } catch {
                            return null;
                        }
                    })()),
            ];
        }),
    ) as Record<'c64' | 'cpc' | 'sharp-mz800', () => Promise<unknown | null>>;
    for (const [mode] of OPTIONAL_GRAPHICS) {
        if (initialModes.includes(mode)) void optional[mode]();
    }
    const responses = await Promise.all([
        fetcher(versionAssetUrl('./data/world.json'), request),
        fetcher(versionAssetUrl(GRAPHICS_ASSETS.retro), request),
    ]);
    if (responses.some((response) => !response.ok))
        throw new Error('Could not load the game maps or graphics.');
    const [world, graphics] = await Promise.all(responses.map((response) => response.json()));
    return {
        world: world as World,
        graphics: graphics as Graphics,
        optional,
    };
}
