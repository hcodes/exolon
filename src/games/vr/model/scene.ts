import type { GameState, Point, Tile, World } from '../../../types/game.ts';

export type VrFamily =
    | 'terrain'
    | 'support'
    | 'ship'
    | 'planet'
    | 'turret'
    | 'gate'
    | 'mine'
    | 'tower'
    | 'teleporter'
    | 'supply'
    | 'sphere-pod'
    | 'pump'
    | 'column'
    | 'barrel'
    | 'platform'
    | 'changing-room'
    | 'beacon'
    | 'wagon'
    | 'stage-gate'
    | 'flash'
    | 'mushroom'
    | 'diagonal'
    | 'voltage';

// Explicit recovered block inventory. Unknown content fails rather than becoming a cube.
const FAMILIES: readonly VrFamily[] = [
    'support',
    'support',
    'ship',
    'planet',
    'planet',
    'turret',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'gate',
    'mine',
    'tower',
    'terrain',
    'tower',
    'tower',
    'teleporter',
    'supply',
    'supply',
    'supply',
    'sphere-pod',
    'pump',
    'terrain',
    'column',
    'column',
    'barrel',
    'column',
    'platform',
    'changing-room',
    'planet',
    'beacon',
    'beacon',
    'terrain',
    'column',
    'planet',
    'planet',
    'planet',
    'terrain',
    'sphere-pod',
    'wagon',
    'terrain',
    'stage-gate',
    'flash',
    'turret',
    'turret',
    'mushroom',
    'barrel',
    'diagonal',
    'diagonal',
    'barrel',
    'voltage',
    'terrain',
    'column',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
    'terrain',
];
export interface VrTile extends Tile {
    x: number;
    y: number;
}
export interface VrInstance {
    instance: number;
    block: number;
    family: VrFamily;
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: VrTile[];
}
export const domainToPixel = (point: Point): Point => ({ x: point.x * 2, y: point.y });
export const eventToPixel = (point: Point): Point => ({ x: point.x, y: point.y });
export const tileToPixel = (point: Point): Point => ({ x: point.x * 8, y: point.y * 8 });
export const pixelToScene = (point: Point): Point => ({ x: point.x - 128, y: 176 - point.y });

export function inventoryVrWorld(world: World) {
    const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
    const blocks = sorted(
        world.screens.flatMap((screen) =>
            screen.tiles.flatMap((tile) => (tile ? [tile.block] : [])),
        ),
    );
    const actions = sorted(
        world.screens.flatMap((screen) =>
            (screen.objects || screen.actions || []).map((object) => object.type),
        ),
    );
    const enemies = sorted((world.enemies || []).map((enemy) => enemy.sprite));
    return {
        screens: world.screens.length,
        blocks,
        unsupportedBlocks: blocks.filter((block) => !FAMILIES[block]),
        actions,
        enemies,
        unsupportedActions: actions.filter((type) => type < 2 || type > 17),
        unsupportedEnemies: enemies.filter((sprite) => ![1, 16, 20, 24, 37, 41].includes(sprite)),
    };
}

export function describeVrScene(state: GameState): { instances: VrInstance[] } {
    const destroyed = new Set(state.destroyed);
    const collected = new Set(
        state.objects
            .filter((object) => !object.active && [7, 8].includes(object.type))
            .map((object) => object.instance),
    );
    const groups = new Map<number, VrInstance>();
    for (let index = 0; index < Math.min(704, state.screen.tiles.length); index++) {
        const tile = state.screen.tiles[index];
        if (
            !tile ||
            tile.ink === false ||
            destroyed.has(tile.instance!) ||
            collected.has(tile.instance)
        )
            continue;
        const instance = tile.instance ?? -(index + 1);
        const x = (index % 32) * 8;
        const y = Math.floor(index / 32) * 8;
        let item = groups.get(instance);
        if (!item) {
            const family = FAMILIES[tile.block];
            if (!family) throw new Error(`Unsupported VR block ${tile.block}`);
            item = { instance, block: tile.block, family, x, y, width: 8, height: 8, tiles: [] };
            groups.set(instance, item);
        }
        item.width = Math.max(item.x + item.width, x + 8) - Math.min(item.x, x);
        item.height = Math.max(item.y + item.height, y + 8) - Math.min(item.y, y);
        item.x = Math.min(item.x, x);
        item.y = Math.min(item.y, y);
        item.tiles.push({ ...tile, x, y });
    }
    return { instances: [...groups.values()] };
}
