import type { NativeGraphics } from '../types/graphics.ts';
import type { NativeWorld } from '../types/world.ts';
const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));
const indices = (value: unknown, length: number, max = 15): value is number[] =>
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= max);
const palette = (value: unknown): boolean =>
    Array.isArray(value) && value.length === 16 && value.every((color) => indices(color, 3, 255));
export function validateNativeResources(
    worldValue: unknown,
    graphicsValue: unknown,
    platform = 'Amiga',
): { world: NativeWorld; graphics: NativeGraphics } {
    const fail = () => {
        throw new Error('Incomplete or corrupt original ' + platform + ' resources.');
    };
    if (!record(worldValue) || !record(graphicsValue)) return fail();
    const screens = worldValue.screens;
    if (
        !Array.isArray(screens) ||
        screens.length !== 125 ||
        worldValue.screenWidth !== 320 ||
        worldValue.screenHeight !== 200 ||
        worldValue.width !== 40 ||
        worldValue.height !== 23
    )
        return fail();
    for (const [index, screen] of screens.entries())
        if (
            !record(screen) ||
            screen.index !== index ||
            screen.stage !== Math.floor(index / 25) ||
            !indices(screen.tiles, 920, 255) ||
            !Array.isArray(screen.static) ||
            screen.static.length > 1000
        )
            return fail();
    const resources = graphicsValue.resources;
    if (!record(resources) || Object.keys(resources).length > 256) return fail();
    for (const key of [
        'player',
        'player-armored',
        'hud',
        'logo',
        'window-tiles',
        'menu-stars',
        'game-stars',
        'score-pipe',
        'death',
        'bullets',
        'debris',
        'powerups',
        'teleport',
        'pod-particles',
        'turret-animation-0',
        'turret-animation-1',
        'laser-animation',
        'energy-beam',
        'rocket',
        'missile',
        'large-explosion',
        'mines',
        'spikes',
        'exit-gate',
    ])
        if (!record(resources[key])) return fail();
    for (const shape of Object.values(resources)) {
        if (
            !record(shape) ||
            typeof shape.width !== 'number' ||
            typeof shape.height !== 'number' ||
            !Number.isInteger(shape.width) ||
            !Number.isInteger(shape.height) ||
            shape.width < 1 ||
            shape.width > 320 ||
            shape.height < 1 ||
            shape.height > 200 ||
            !Array.isArray(shape.frames) ||
            !shape.frames.length ||
            shape.frames.length > 100 ||
            !shape.frames.every((frame) =>
                indices(frame, Number(shape.width) * Number(shape.height)),
            )
        )
            return fail();
    }
    // These native blitters index frames directly rather than wrapping them.
    for (const [name, width, height, frames] of [
        ['game-stars', 8, 7, 9],
        ['menu-stars', 16, 16, 7],
        ['window-tiles', 16, 16, 6],
        ['spikes', 32, 49, 1],
    ] as const) {
        const source = resources[name];
        if (
            !record(source) ||
            source.width !== width ||
            source.height !== height ||
            !Array.isArray(source.frames) ||
            source.frames.length !== frames
        )
            return fail();
    }
    if (
        !palette(graphicsValue.palette) ||
        !Array.isArray(graphicsValue.stagePalettes) ||
        graphicsValue.stagePalettes.length !== 5 ||
        !graphicsValue.stagePalettes.every(palette) ||
        !indices(graphicsValue.stageTileSets, 5, 1)
    )
        return fail();
    if (
        !Array.isArray(graphicsValue.stageFlyers) ||
        graphicsValue.stageFlyers.length !== 5 ||
        !graphicsValue.stageFlyers.every(
            (bank) =>
                Array.isArray(bank) &&
                bank.length === 4 &&
                bank.every((name) => typeof name === 'string' && resources[name]),
        )
    )
        return fail();
    if (
        !Array.isArray(graphicsValue.tilesets) ||
        graphicsValue.tilesets.length !== 2 ||
        !graphicsValue.tilesets.every(
            (set) =>
                Array.isArray(set) && set.length === 256 && set.every((tile) => indices(tile, 64)),
        )
    )
        return fail();
    if (
        !Array.isArray(graphicsValue.font) ||
        graphicsValue.font.length < 38 ||
        graphicsValue.font.length > 39 ||
        !graphicsValue.font.every((glyph) => indices(glyph, 8, 255)) ||
        !Array.isArray(graphicsValue.hudFont) ||
        graphicsValue.hudFont.length !== 10 ||
        !graphicsValue.hudFont.every((glyph) => indices(glyph, 7, 255))
    )
        return fail();
    if (
        graphicsValue.asciiFont !== undefined &&
        (!Array.isArray(graphicsValue.asciiFont) ||
            graphicsValue.asciiFont.length !== 256 ||
            !graphicsValue.asciiFont.every((glyph) => indices(glyph, 8, 255)))
    )
        return fail();
    const text = graphicsValue.text;
    if (!record(text)) return fail();
    for (const key of ['menu', 'nameEntry', 'bonus', 'bravery', 'lifeBonus', 'ending', 'gameOver'])
        if (!Array.isArray(text[key]) || !text[key].length) return fail();
    for (const list of Object.values(text))
        if (
            !Array.isArray(list) ||
            list.length > 100 ||
            !list.every(
                (item) =>
                    record(item) &&
                    (item.ink === undefined ||
                        (Number.isInteger(item.ink) &&
                            Number(item.ink) >= 0 &&
                            Number(item.ink) <= 15)) &&
                    typeof item.text === 'string' &&
                    item.text.length <= 80 &&
                    typeof item.x === 'number' &&
                    Number.isInteger(item.x) &&
                    item.x >= 0 &&
                    item.x < 320 &&
                    typeof item.y === 'number' &&
                    Number.isInteger(item.y) &&
                    item.y >= 0 &&
                    item.y < 200,
            )
        )
            return fail();
    if (
        !Array.isArray(graphicsValue.highScores) ||
        graphicsValue.highScores.length < 1 ||
        graphicsValue.highScores.length > 34 ||
        !graphicsValue.highScores.every(
            (row) =>
                record(row) &&
                typeof row.name === 'string' &&
                row.name.length <= 10 &&
                typeof row.score === 'number' &&
                Number.isInteger(row.score) &&
                row.score >= 0 &&
                row.score <= 999999,
        )
    )
        return fail();
    for (const screen of screens)
        for (const item of screen.static) {
            if (
                !record(item) ||
                typeof item.resource !== 'string' ||
                !record(resources[item.resource]) ||
                typeof item.transparent !== 'boolean' ||
                !Number.isInteger(item.x) ||
                !Number.isInteger(item.y)
            )
                return fail();
            const source = resources[item.resource];
            if (!record(source)) return fail();
            if (
                item.width !== source.width ||
                item.height !== source.height ||
                Number(item.x) < -320 ||
                Number(item.x) > 320 ||
                Number(item.y) < -200 ||
                Number(item.y) > 200
            )
                return fail();
        }
    return {
        world: worldValue as unknown as NativeWorld,
        graphics: graphicsValue as unknown as NativeGraphics,
    };
}
