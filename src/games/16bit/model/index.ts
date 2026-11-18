import { AMIGA_ROCKET_TRAIL_FRAMES } from '../../amiga/constants/rocket-trail.ts';
import { spawnAmigaDebris } from '../../amiga/model/debris.ts';
import { nextAmigaRandom } from '../../amiga/utils/random.ts';

import type {
    NativeCommands,
    NativeEntity,
    NativeEntityKind,
    NativeEvent,
    NativeOptions,
    NativeState,
    NativeStep,
    NativeWorld,
} from '../types/index.ts';

export interface NativeModelTables {
    readonly source?: string;
    readonly turretBaseGraphics?: readonly number[];
    readonly turretAnimationGraphics?: readonly number[];
    readonly turretStates?: readonly number[];
    readonly stageEnds?: readonly number[];
    readonly jumpVertical: readonly number[];
    readonly jumpLeft: readonly (readonly number[])[];
    readonly jumpRight: readonly (readonly number[])[];
    readonly grenade: readonly (readonly number[])[];
    readonly podParticles: readonly (readonly number[])[];
    readonly flyerPaths: Readonly<Record<string, readonly (readonly number[])[]>>;
    readonly screens: readonly {
        readonly index: number;
        readonly pickups: readonly number[];
        readonly podTypes: readonly number[];
        readonly flyer: readonly number[];
        readonly spikeColumns: readonly number[];
        readonly fillDestroyedBodies: number;
        readonly turretTypes: readonly number[];
        readonly barrierTypes: readonly number[];
    }[];
    readonly bonusRoulette: readonly number[];
}
/** Shared handwritten 68000 rules. Each release supplies its independently recovered tables. */
export function createNativeModel(native: NativeModelTables, random = nextAmigaRandom) {
    type Rect = { x: number; y: number; width: number; height: number };
    /** Literal $e164..$e2f4 corner tests, including the final $e2d8 inclusive Y.
     * This intentionally rejects crossing rectangles whose corners are all outside. */
    function nativeNativeOverlap(a: Rect, b: Rect): boolean {
        const inside = (x: number, y: number, rectangle: Rect, inclusiveBottom = false): boolean =>
            x >= rectangle.x &&
            x <= rectangle.x + rectangle.width &&
            y >= rectangle.y &&
            (inclusiveBottom
                ? y <= rectangle.y + rectangle.height
                : y < rectangle.y + rectangle.height);
        return (
            inside(a.x, a.y, b) ||
            inside(a.x + a.width, a.y, b) ||
            inside(a.x + a.width, a.y + a.height, b) ||
            inside(a.x, a.y + a.height, b) ||
            inside(b.x + b.width, b.y + b.height, a) ||
            inside(b.x, b.y + b.height, a) ||
            inside(b.x + b.width, b.y, a) ||
            inside(b.x, b.y, a, true)
        );
    }
    const overlap = nativeNativeOverlap;
    const solid = (tile: number): boolean => tile >= 0x78 && tile <= 0xa6;
    const body = (state: NativeState): Rect => ({
        x: state.player.x,
        y: state.player.y - 40,
        width: 32,
        height: 40,
    });

    function entity(
        state: NativeState,
        kind: NativeEntityKind,
        x: number,
        y: number,
        width: number,
        height: number,
        type = 0,
    ): NativeEntity {
        const result: NativeEntity = {
            id: state.nextEntityId++,
            kind,
            x,
            y,
            width,
            height,
            frame: 0,
            type,
            alive: true,
            phase: 0,
            dx: 0,
            dy: 0,
        };
        state.entities.push(result);
        return result;
    }

    function metadata(state: NativeState) {
        return native.screens[state.screenIndex] ?? native.screens[0];
    }

    /** $c93a and $cd2e..$d340: maps and independently indexed 125-screen object tables. */
    function enterScreen(state: NativeState, index: number): void {
        state.screenIndex = index;
        state.tiles = [...(state.world.screens[index]?.tiles ?? [])];
        state.entities = [];
        state.player.x = 3;
        state.player.spawnX = 3;
        state.player.spawnY = state.player.y;
        state.player.ducked = false;
        state.hunterTicks = 0;
        state.bonusClaimed = false;
        const data = metadata(state);
        let barrierIndex = 0;
        let podIndex = 0;
        let turretIndex = 0;
        for (let i = 0; i < 920; i++) {
            const tile = state.tiles[i];
            const x = (i % 40) * 8;
            const y = Math.floor(i / 40) * 8;
            if (tile === 0xff || tile === 0xf7) {
                entity(state, 'barrier', x, y, 64, 64, data.barrierTypes[barrierIndex++] ?? 0);
            } else if (tile === 0xf5 || tile === 0xf6) {
                const pod = entity(state, 'pod', x, y, 64, 64, data.podTypes[podIndex++] ?? 0);
                for (const [px, py] of native.podParticles) {
                    const particle = entity(state, 'pod-particle', x + px, y + py, 8, 8, pod.type);
                    particle.parentId = pod.id;
                    particle.sourceX = x;
                    particle.sourceY = y;
                }
            } else if (tile === 0xfc || tile === 0xf8) {
                const turret = entity(
                    state,
                    'turret',
                    x,
                    y,
                    64,
                    64,
                    data.turretTypes[turretIndex++] ?? 0,
                );
                turret.phase = turret.type === 2 ? 8 : 4;
            } else if (tile === 0x7b) {
                entity(state, 'teleport', x + 8, y, 32, 32);
            } else if (tile === 0xfb) {
                entity(state, 'laser', x + 8, y - 32, 32, 32);
            } else if (tile === 0xf9) {
                const laser = entity(state, 'laser', x + 8, 32, 8, 168, 1);
                laser.health = 20;
            } else if (tile === 0xa2) {
                const mine = entity(state, 'mine', x, y, 16, 8);
                mine.phase = i;
            }
        }
        for (let i = 0; i < 2; i++) {
            const x = data.pickups[i * 2];
            const y = data.pickups[i * 2 + 1];
            if (x !== 501) entity(state, 'pickup', x, y, 16, 16, i);
        }
        for (const column of data.spikeColumns) {
            if (column === 100) break;
            entity(state, 'spike', column * 16, 175, 32, 0);
        }
    }

    /** Direct/cheat starts have no adjacent-screen height to inherit. Select the
     * first supported entry surface with the complete40px body footprint clear.
     * Native adjacent transitions continue to preserve their carried Y unchanged. */
    function directEntryHeight(tiles: readonly number[]): number {
        for (let row = 5; row < 23; row++) {
            if (!tiles.slice(row * 40, row * 40 + 4).some(solid)) continue;
            let clear = true;
            for (let bodyRow = row - 5; bodyRow < row; bodyRow++) {
                if (tiles.slice(bodyRow * 40, bodyRow * 40 + 5).some(solid)) {
                    clear = false;
                    break;
                }
            }
            if (clear) return row * 8;
        }
        return 176;
    }

    function createNativeState(world: NativeWorld, options: NativeOptions = {}): NativeState {
        if (!world || !Array.isArray(world.screens) || !world.screens.length) {
            throw new RangeError('Native world requires at least one screen');
        }
        for (const screen of world.screens) {
            if (!screen || !Array.isArray(screen.tiles) || screen.tiles.length !== 920) {
                throw new RangeError('Native screen requires920 map tiles');
            }
        }
        const requested = Number.isFinite(options.screenIndex)
            ? Math.floor(options.screenIndex!)
            : 0;
        const index = Math.max(0, Math.min(world.screens.length - 1, 124, requested));
        const y = directEntryHeight(world.screens[index].tiles);
        const state: NativeState = {
            world,
            options: { ...options },
            screenIndex: index,
            status: 'playing',
            tick: 0,
            teleportPhase: 13,
            teleportFrame: -1,
            score: 0,
            lives: 9,
            ammo: 99,
            grenades: 9,
            player: {
                x: 3,
                y,
                pose: 0,
                facing: 'right',
                ducked: false,
                jumpKind: 0,
                jumpIndex: 0,
                deathTick: 15,
                invulnerableTicks: 0,
                armored: false,
                spawnX: 3,
                spawnY: y,
                deathX: 3,
                deathY: y,
            },
            entities: [],
            tiles: [],
            fireHeld: false,
            fireTicks: 0,
            nextEntityId: 1,
            randomSeed: Number.isFinite(options.seed) ? options.seed! >>> 0 : 0x19871201,
            randomSeedHigh: Number.isFinite(options.seedHigh)
                ? options.seedHigh! >>> 0
                : 0x12345678,
            bonusTicks: 0,
            bonusPhase: 'summary',
            pendingScore: 0,
            bonusClaimed: false,
            hunterTicks: 0,
        };
        enterScreen(state, index);
        return state;
    }

    function mapTile(state: NativeState, x: number, y: number): number {
        if (x < 0 || x >= 320 || y < 0 || y >= 184) return 0;
        return state.tiles[Math.floor(y / 8) * 40 + Math.floor(x / 8)] ?? 0;
    }

    /** Exactly the sampled map bytes in $e8d6/$e9bc/$e9f0/$ea24. */
    function rowSolid(state: NativeState, offset: number, count: number): boolean {
        const p = state.player;
        const col = Math.floor(p.x / 8);
        const row = Math.floor((p.y - 39) / 8);
        for (let i = 0; i < count; i++) {
            if (solid(state.tiles[row * 40 + col + offset + i] ?? 0)) return true;
        }
        return false;
    }

    function blocked(state: NativeState, rectangle: Rect): boolean {
        return state.entities.some(
            (e) =>
                e.alive &&
                (e.kind === 'barrier' ||
                    (e.kind === 'pod' && e.type === 0) ||
                    (e.kind === 'turret' && e.type < 2)) &&
                overlap(rectangle, {
                    ...e,
                    height: e.kind === 'turret' && e.type === 1 ? 32 : e.height,
                }),
        );
    }

    function explode(
        state: NativeState,
        x: number,
        y: number,
        events: NativeEvent[],
        small = false,
    ): void {
        // $a970/$a926: intact-object hits use frames1..8 of the32x8 impact.
        entity(state, 'explosion', x, y, 32, small ? 8 : 32, small ? 1 : 0).life = small ? 9 : 8;
        events.push({ type: 'explosion', x, y });
    }

    /** $ab78: native screen-entry checkpoint, 15 death frames and 26 protected ticks. */
    function kill(state: NativeState, events: NativeEvent[], offscreen = false): void {
        const p = state.player;
        if (
            !offscreen &&
            (state.options.invulnerable || p.invulnerableTicks > 0 || p.deathTick < 15)
        )
            return;
        // Browser safety for direct starts and cheated falls: immunity may suppress
        // damage, but must never strand the player below the map indefinitely.
        if (offscreen) {
            p.spawnY = directEntryHeight(state.tiles);
            p.ducked = false;
            p.pose = p.facing === 'left' ? 15 : 0;
        }
        p.deathX = p.x;
        p.deathY = p.y;
        p.x = p.spawnX;
        p.y = p.spawnY;
        p.jumpKind = 0;
        p.deathTick = 0;
        p.invulnerableTicks = 26;
        state.hunterTicks = 0;
        state.ammo = 99;
        state.grenades = 10;
        if (!state.options.infiniteLives && !(offscreen && state.options.invulnerable))
            state.lives = Math.max(0, state.lives - 1);
        events.push({ type: 'death', x: p.deathX, y: p.deathY - 40 });
    }

    function launchRocket(state: NativeState, events: NativeEvent[]): void {
        if (
            state.entities.some((e) => e.kind === 'grenade' && e.alive) ||
            (state.grenades <= 0 && !state.options.infiniteGrenades)
        )
            return;
        const p = state.player;
        const direction = p.facing === 'right' ? 1 : -1;
        if (!state.options.infiniteGrenades) state.grenades--;
        const grenade = entity(state, 'grenade', p.x + (direction > 0 ? 2 : 18), p.y - 35, 14, 6);
        grenade.dx = direction;
        events.push({ type: 'grenade', x: grenade.x, y: grenade.y });
    }

    function fire(state: NativeState, command: NativeCommands, events: NativeEvent[]): void {
        if (command.rocket) launchRocket(state, events);
        if (!command.fire) {
            state.fireHeld = false;
            return;
        }
        const p = state.player;
        const direction = p.facing === 'right' ? 1 : -1;
        if (!state.fireHeld || command.firePressed) {
            state.fireHeld = true;
            state.fireTicks = 0;
            if (state.ammo <= 0 && !state.options.infiniteAmmo) return;
            if (state.entities.filter((e) => e.kind === 'bullet' && e.alive).length >= 8) return;
            if (!state.options.infiniteAmmo) state.ammo--;
            const bullet = entity(
                state,
                'bullet',
                p.x + (direction > 0 ? 22 : -8),
                p.y - 28,
                14,
                6,
            );
            bullet.dx = 12 * direction;
            bullet.life = 15;
            if (p.armored) {
                const second = entity(
                    state,
                    'bullet',
                    p.x + (direction > 0 ? 23 : -7),
                    p.y - 21,
                    14,
                    6,
                );
                second.dx = bullet.dx;
                second.life = 15;
            }
            events.push({ type: 'shot', x: p.x, y: p.y - 28 });
        } else if (command.chargeRocket !== false && ++state.fireTicks >= 10) {
            state.fireTicks = 0;
            launchRocket(state, events);
        }
    }

    function teleport(state: NativeState, events: NativeEvent[]): boolean {
        if (state.teleportPhase <= 3) return false; // Native $d498 recovery interval.
        const pads = state.entities.filter((e) => e.kind === 'teleport');
        if (pads.length < 2) return false;
        const p = state.player;
        const index = pads.findIndex((pad) =>
            overlap(
                { x: p.x + 12, y: p.y - 40, width: 8, height: 18 },
                { x: pad.x - 9, y: pad.y + 16, width: 11, height: 32 },
            ),
        );
        if (index < 0) return false;
        const other = pads[index === 0 ? 1 : 0];
        p.x = other.x - 20;
        p.y = other.y + 56;
        if (state.teleportPhase >= 7) state.teleportPhase = 0; // Native $d5ae.
        events.push({ type: 'teleport', x: p.x, y: p.y - 40 });
        return true;
    }

    /** $e376..$ee50. Jump arcs are original signed-word tables, without velocity integration. */
    function advanceJump(state: NativeState, events: NativeEvent[]): boolean {
        const p = state.player;
        if (p.y > 40 && rowSolid(state, 0, 5)) {
            p.jumpKind = 0;
            return false;
        }
        const kind = p.jumpKind;
        const delta =
            kind === 1
                ? [0, native.jumpVertical[p.jumpIndex]]
                : (kind === 2 ? native.jumpLeft : native.jumpRight)[p.jumpIndex];
        if (!delta) {
            p.jumpKind = 0;
            return false;
        }
        const [dx, dy] = delta;
        if (dy >= 0 && rowSolid(state, kind === 2 ? 201 : 200, kind === 1 ? 5 : 4)) {
            p.y += 4;
            p.jumpKind = 0;
            return false;
        }
        if (kind !== 1) {
            const mapIndex = Math.floor((p.y - 39) / 8) * 40 + Math.floor(p.x / 8);
            // $ec6c/$ed56 deliberately retain the current table pair on a tile
            // side contact. Right jumps additionally push four pixels left.
            if (
                (kind === 2 || p.x < 288) &&
                solid(state.tiles[mapIndex + (kind === 2 ? 119 : 164)] ?? 0)
            ) {
                if (kind === 3) p.x -= 4;
                p.y += dy;
                return true;
            }
            const side = {
                x: p.x + (kind === 2 ? 0 : 10),
                y: p.y - 40,
                width: kind === 2 ? 10 : 22,
                height: 40,
            };
            if (blocked(state, side)) {
                p.jumpKind = 0;
                return false;
            }
        }
        p.y += dy;
        if (kind === 2 && p.x > 4) p.x += dx;
        if (kind === 3) {
            // $edec checks the old X before adding this pair's horizontal delta.
            if (p.x >= 310) advance(state, events);
            p.x += dx;
        }
        p.jumpIndex++;
        if (p.jumpIndex >= 15) p.jumpKind = 0;
        return p.jumpKind !== 0;
    }

    function movePlayer(state: NativeState, command: NativeCommands, events: NativeEvent[]): void {
        const p = state.player;
        if (!Number.isFinite(p.y) || p.y > 224) {
            kill(state, events, true);
            return;
        }
        fire(state, command, events);
        if (p.ducked) {
            const y = p.y;
            p.y -= 6;
            const floor = rowSolid(state, 200, 5);
            p.y = y;
            if (!floor) p.y += 6;
        } else if (p.jumpKind) {
            if (advanceJump(state, events)) return;
        }
        if (!p.ducked) {
            if (!rowSolid(state, p.facing === 'left' ? 201 : 200, p.x > 288 ? 2 : 4)) {
                p.y += 4;
                if (p.y > 224) kill(state, events, true);
                return;
            }
            p.y &= ~7;
        }
        if (command.duck) {
            if (!p.ducked) {
                p.ducked = true;
                p.y += 6;
                p.pose = p.facing === 'left' ? 29 : 14;
            }
            return;
        }
        if (p.ducked) {
            p.y -= 6;
            p.ducked = false;
            p.pose -= 14;
        }
        if (command.jump) {
            const col = Math.floor(p.x / 8);
            const row = Math.floor((p.y - 39) / 8);
            if (state.tiles.slice((row - 1) * 40 + col, (row - 1) * 40 + col + 6).includes(0x78)) {
                p.armored = !p.armored;
                events.push({ type: 'armor', value: p.armored ? 1 : 0 });
            }
            if (teleport(state, events)) return;
            p.jumpKind = command.left ? 2 : command.right ? 3 : 1;
            p.jumpIndex = 0;
            if (command.left) p.facing = 'left';
            if (command.right && !command.left) p.facing = 'right';
            p.pose = p.facing === 'left' ? 28 : 13;
            return;
        }
        const direction = command.left ? -1 : command.right ? 1 : 0;
        if (!direction) {
            p.pose = p.facing === 'left' ? 15 : 0;
            return;
        }
        if (direction < 0 && p.x <= 3) return;
        if (direction > 0 && p.x >= 310) {
            advance(state, events);
            return;
        }
        const side: Rect = {
            x: p.x + (direction < 0 ? 0 : 20),
            y: p.y - 40,
            width: direction < 0 ? 10 : 12,
            height: direction < 0 ? 40 : 43,
        };
        if (blocked(state, side)) return;
        const tile = mapTile(state, p.x + (direction < 0 ? 0 : 32), p.y - 7);
        if (solid(tile)) return;
        const facing = direction < 0 ? 'left' : 'right';
        if (p.facing !== facing) {
            p.facing = facing;
            p.pose = direction < 0 ? 15 : 0;
            return;
        }
        p.pose = direction < 0 ? (p.pose >= 27 ? 16 : p.pose + 1) : p.pose >= 12 ? 1 : p.pose + 1;
        p.x += direction * 3;
    }

    function advance(state: NativeState, events: NativeEvent[]): void {
        if (state.screenIndex + 1 >= state.world.screens.length) {
            state.status = 'won';
            events.push({ type: 'won' });
        } else {
            enterScreen(state, state.screenIndex + 1);
            events.push({ type: 'screen', value: state.screenIndex });
        }
    }

    function destroyTarget(state: NativeState, target: NativeEntity, events: NativeEvent[]): void {
        target.alive = false;
        if (target.kind === 'laser' && target.type === 0) {
            // Native $a806 returns before guided-rocket updates once its launcher is gone.
            for (const child of state.entities)
                if (child.kind === 'hunter' && child.type === 1 && child.parentId === target.id)
                    child.alive = false;
        }
        if (target.kind === 'barrier' || target.kind === 'pod' || target.kind === 'turret') {
            // Static composites share this marker in world.json. Clearing the copied
            // marker lets the view remove the background image with the collision body.
            state.tiles[Math.floor(target.y / 8) * 40 + Math.floor(target.x / 8)] = 0;
        }
        spawnAmigaDebris(state, target);
        events.push({ type: 'explosion', x: target.x, y: target.y });
        if (target.kind !== 'laser' || target.type !== 1) state.score += 150;
        if (target.kind === 'pod') {
            for (const particle of state.entities)
                if (particle.parentId === target.id) particle.type = 1;
        }
    }

    /** $9886: seven fixed puffs behind the pre-movement rocket position. */
    function leaveRocketSmoke(state: NativeState, rocket: NativeEntity): void {
        const occupied = new Set(
            state.entities
                .filter((e) => e.kind === 'rocket-trail' && e.alive && e.phase < 6)
                .map((e) => e.path),
        );
        let slot = 0;
        while (occupied.has(slot)) slot++;
        if (slot >= 20) return;
        const puff = entity(
            state,
            'rocket-trail',
            rocket.x + (rocket.dx < 0 ? 13 : -4),
            rocket.y,
            16,
            6,
            rocket.dx < 0 ? 1 : 0,
        );
        puff.path = slot;
        puff.life = 6;
    }

    function updateProjectiles(state: NativeState, events: NativeEvent[]): void {
        for (const projectile of state.entities.filter(
            (e) => e.alive && (e.kind === 'bullet' || e.kind === 'grenade'),
        )) {
            if (projectile.kind === 'bullet') {
                if ((projectile.life ?? 0) <= 1 || projectile.x < 6 || projectile.x >= 290) {
                    projectile.alive = false;
                    continue;
                }
                projectile.life = (projectile.life ?? 15) - 1;
                projectile.x += projectile.dx;
            } else {
                if (projectile.phase < 7) leaveRocketSmoke(state, projectile);
                const delta = native.grenade[projectile.phase++];
                if (!delta || (projectile.dx < 0 ? projectile.x <= 8 : projectile.x >= 304)) {
                    projectile.alive = false;
                    continue;
                }
                if (
                    solid(mapTile(state, projectile.x + 6, projectile.y)) ||
                    solid(mapTile(state, projectile.x + 6, projectile.y + 6))
                ) {
                    projectile.alive = false;
                    explode(state, projectile.x, projectile.y, events, true);
                } else {
                    projectile.x += delta[0] * projectile.dx;
                    projectile.y += delta[1];
                }
            }
            if (!projectile.alive) continue;
            for (const target of state.entities) {
                if (!target.alive || target === projectile) continue;
                // $b07c: the vertical laser is a twenty-hit screen barrier. Grenades
                // disappear at its X coordinate; only bullets reduce its charge.
                if (
                    target.kind === 'laser' &&
                    target.type === 1 &&
                    projectile.x + (projectile.kind === 'bullet' ? 24 : 10) >= target.x
                ) {
                    projectile.alive = false;
                    if (projectile.kind === 'bullet') {
                        target.health = (target.health ?? 20) - 1;

                        state.pendingScore += 20;
                        explode(state, projectile.x, projectile.y, events, true);
                        if (target.health <= 0) destroyTarget(state, target, events);
                    }
                    break;
                }
                if (
                    target.kind === 'barrier' ||
                    target.kind === 'pod' ||
                    target.kind === 'turret'
                ) {
                    if (target.kind === 'pod' && target.type !== 0) continue;
                    if (target.kind === 'turret' && target.type >= 2) continue;
                    if (
                        !overlap(projectile, {
                            ...target,
                            height:
                                target.kind === 'turret' && target.type === 1 ? 32 : target.height,
                        })
                    )
                        continue;
                    projectile.alive = false;
                    if (projectile.kind === 'grenade') destroyTarget(state, target, events);
                    else {
                        explode(state, projectile.x, projectile.y, events, true);
                    }
                    break;
                }
                // Native $afc6 tests the launcher only while a grenade is active.
                if (target.kind === 'laser' && target.type === 0 && projectile.kind === 'bullet')
                    continue;
                if (
                    target.kind === 'flyer' ||
                    (target.kind === 'hunter' && target.type !== 1) ||
                    target.kind === 'laser' ||
                    (target.kind === 'pod-particle' && target.type === 1) ||
                    target.kind === 'enemy-bullet'
                ) {
                    if (!overlap(projectile, target)) continue;
                    projectile.alive = false;
                    if (target.kind === 'laser') destroyTarget(state, target, events);
                    else {
                        target.alive = false;
                        state.score += target.kind === 'flyer' ? 150 : 50;
                        explode(state, target.x, target.y, events);
                    }
                    break;
                }
            }
        }
    }

    function updateEnemies(state: NativeState, events: NativeEvent[]): void {
        const p = state.player;
        const data = metadata(state);
        // $a042: at most five independently cycling 6-frame flyers, spawned only from the right.
        if (
            data.flyer[0] &&
            p.x <= 220 &&
            !state.entities.some((e) => e.kind === 'flyer' && e.alive && e.x > 232) &&
            state.entities.filter((e) => e.kind === 'flyer' && e.alive).length < 5 &&
            random(state) <= 80
        ) {
            const flyer = entity(
                state,
                'flyer',
                320,
                p.y - 40 - (random(state) & 7),
                24,
                24,
                data.flyer[0],
            );
            flyer.path = data.flyer[1];
        }
        for (const e of [...state.entities]) {
            if (!e.alive) continue;
            if (e.kind === 'flyer') {
                const path = native.flyerPaths['0x' + (e.path ?? 0).toString(16)];
                if (path) {
                    const delta = path[e.phase % path.length];
                    e.x += delta[0];
                    e.y += delta[1];
                    e.phase++;
                } else {
                    e.x += e.dx;
                    e.y += e.dy;
                }
                e.frame = (e.frame + 1) % 6;
                if (e.x <= -32) e.alive = false;
            } else if (e.kind === 'pod-particle') {
                const parent = state.entities.find((candidate) => candidate.id === e.parentId);
                const confined = parent?.alive && parent.type === 0;
                const loX = confined ? (e.sourceX ?? 0) + 15 : 10;
                const hiX = confined ? (e.sourceX ?? 0) + 32 : 300;
                const loY = confined ? (e.sourceY ?? 0) + 10 : (e.sourceY ?? 0);
                const hiY = confined ? (e.sourceY ?? 0) + 19 : (e.sourceY ?? 0) + 45;
                const n = random(state);
                if (n <= 5 && e.y >= loY) e.y -= 4;
                else if (n <= 17 && e.y <= hiY) e.y += 4;
                else if (n <= 140 && e.x <= hiX) e.x += 4;
                else if (n > 140 && e.x >= loX) e.x -= 4;
            } else if (e.kind === 'turret' && e.type <= 2) {
                // Native states1/2 use the animated upper gun; state3 is the low
                // double-projectile gun. Its bonus does not disable firing ($b972).
                const low = e.type === 2;
                if (!low && e.phase < 4) {
                    e.phase++;
                    continue;
                }
                const canFire = !low || e.x - 50 >= p.x;
                if (canFire && random(state) < (low ? 14 : 11)) {
                    const shot = entity(
                        state,
                        'enemy-bullet',
                        e.x - (low ? 4 : 0),
                        e.y + (low ? 4 + (random(state) <= 120 ? 8 : 0) : e.type === 0 ? 23 : 6),
                        10,
                        6,
                        low ? 1 : 0,
                    );
                    shot.dx = -12;
                    if (!low) e.phase = 0;
                    events.push({ type: 'enemy-shot', x: shot.x, y: shot.y });
                }
            } else if (e.kind === 'enemy-bullet') {
                e.x += e.dx;
                e.y += e.dy;
                if (e.x <= 13 || solid(mapTile(state, e.x, e.y))) e.alive = false;
            } else if (e.kind === 'laser' && e.type === 0) {
                if (
                    !state.entities.some(
                        (shot) => shot.kind === 'hunter' && shot.parentId === e.id && shot.alive,
                    )
                ) {
                    const shot = entity(state, 'hunter', 320, random(state) % 176, 24, 15);
                    shot.parentId = e.id;
                    shot.type = 1;
                    shot.dx = -5;
                }
                e.frame = (e.frame + 1) % 4;
            } else if (e.kind === 'hunter') {
                // Native $a580 applies the stored speed (initially5), then $a5d8
                // selects4/6/7 for the following update from the new X coordinate.
                e.x += e.dx;
                if (e.x <= 5) e.alive = false;
                else if (e.type === 1) {
                    const targetY = p.y - 30;
                    if (targetY < e.y) e.y -= 2;
                    else if (targetY - 10 >= e.y) e.y += 2;
                    e.dx = e.x >= 150 ? -4 : e.x >= 110 ? -6 : -7;
                }
            } else if (e.kind === 'rocket-trail') {
                // $98dc draws before decrement/retirement, so the sixth frame remains visible.
                if (e.phase >= 6) e.alive = false;
                else {
                    e.frame = AMIGA_ROCKET_TRAIL_FRAMES[e.type === 1 ? 1 : 0][e.phase++];
                    e.life = 6 - e.phase;
                }
            } else if (e.kind === 'debris') {
                e.x += e.dx;
                e.y += e.dy;
                // Native $bf8a..$bfb6 bounds, with Y normalized by -40.
                if (e.x < 8 || e.x > 304 || e.y < 10 || e.y > 170) e.alive = false;
            } else if (e.kind === 'explosion') {
                e.frame++;
                if (--e.life! <= 0) e.alive = false;
            }
        }
        // $881a: after 300 ticks on one screen a tracking hazard crosses at 5px/tick.
        if (
            ++state.hunterTicks >= 300 &&
            !state.entities.some((e) => e.kind === 'hunter' && e.type === 0 && e.alive)
        ) {
            const hunter = entity(state, 'hunter', 320, p.y - 40, 40, 20);
            hunter.dx = -5;
        }
    }

    /** Native $a3a6 runs after collision checks: draw old height, then advance. */
    function updatePistons(state: NativeState): void {
        for (const piston of state.entities) {
            if (piston.kind !== 'spike' || !piston.alive) continue;
            piston.frame = piston.height;
            if (!piston.phase) {
                if ((random(state, 65535) & 255) < 7) piston.phase = 1;
            } else if (piston.phase === 1) {
                piston.height = Math.min(48, piston.height + 8);
                if (piston.height === 48) piston.phase = 2;
            } else if (piston.phase === 2) {
                piston.height = Math.max(0, piston.height - 8);
                if (!piston.height) piston.phase = 0;
            }
            piston.y = 175 - piston.height;
        }
    }

    function collisions(state: NativeState, events: NativeEvent[]): void {
        const p = state.player;
        const rectangle = body(state);
        for (const e of state.entities) {
            if (!e.alive) continue;
            // $b35e: flyers' damaging interior starts eight pixels into the bob.
            const hurtbox: Rect =
                e.kind === 'flyer'
                    ? { x: e.x + 8, y: e.y, width: 24, height: 22 }
                    : e.kind === 'spike'
                      ? { ...e, y: e.y + 9 }
                      : e.kind === 'hunter'
                        ? { ...e, width: e.type === 1 ? 16 : 20, height: e.type === 1 ? 10 : 40 }
                        : e;
            const playerHurtbox =
                e.kind === 'flyer'
                    ? { ...rectangle, y: rectangle.y + 4, height: rectangle.height - 4 }
                    : rectangle;
            if (e.kind === 'pickup' && overlap(rectangle, e)) {
                if (e.type === 0) state.ammo = 99;
                else state.grenades = 10;
                e.alive = false;
                events.push({ type: 'pickup', value: e.type, x: e.x, y: e.y });
            } else if (
                e.kind === 'mine' &&
                !e.type &&
                p.y >= e.y &&
                p.y <= e.y + 8 &&
                p.x <= e.x + 8 &&
                p.x + 40 >= e.x
            ) {
                e.type = 1;
                state.tiles[e.phase] = 0xa3;
                // $eb26..$eb44:81 orange fragments from the player's foot,
                // using the compact offset table and native palette selector1.
                spawnAmigaDebris(state, { ...e, x: p.x + 12, y: p.y - 5 });
                events.push({ type: 'explosion', x: e.x, y: e.y - 8 });
                if (!p.armored) kill(state, events);
            } else if (
                e.kind === 'turret' &&
                e.type === 2 &&
                !state.bonusClaimed &&
                overlap(rectangle, { ...e, height: 32 })
            ) {
                state.bonusClaimed = true;
                state.pendingScore += 40;
                events.push({ type: 'bonus', value: 2000 });
            } else if (e.kind === 'laser' && e.type === 1 && p.x + 32 >= e.x) {
                kill(state, events);
            } else if (
                (e.kind === 'enemy-bullet' ||
                    e.kind === 'flyer' ||
                    e.kind === 'hunter' ||
                    (e.kind === 'pod-particle' && e.type === 1) ||
                    (e.kind === 'spike' && e.height > 0 && !p.armored)) &&
                overlap(playerHurtbox, hurtbox)
            ) {
                if (e.kind !== 'spike') e.alive = false;
                kill(state, events);
            }
        }
    }

    /** Pure fixed-step model. No browser APIs, other-platform model, or source ROM execution. */
    function stepNative(input: NativeState, command: NativeCommands): NativeStep {
        const state: NativeState = {
            ...input,
            player: { ...input.player },
            options: { ...input.options },
            entities: input.entities.map((e) => ({ ...e })),
            tiles: [...input.tiles],
        };
        const events: NativeEvent[] = [];
        if (state.status === 'over') return { state, events };
        state.tick++;
        if (state.status === 'won') {
            if (!command.fire) state.fireHeld = false;
            else if (!state.fireHeld) {
                state.fireHeld = true;
                state.status = 'playing';
                state.player.y = 176;
                state.player.armored = false;
                state.player.jumpKind = 0;
                state.player.deathTick = 15;
                state.ammo = 99;
                state.grenades = 9;
                enterScreen(state, 0);
                events.push({ type: 'screen', value: 0 });
            }
            return { state, events };
        }
        if (state.status === 'bonus') {
            state.bonusTicks++;
            if (!command.fire) state.fireHeld = false;
            else if (!state.fireHeld) {
                state.fireHeld = true;
                if (state.bonusPhase === 'summary') {
                    state.bonusPhase = state.screenIndex === 124 ? 'ending' : 'roulette';
                    state.bonusTicks = 0;
                    return { state, events };
                }
                if (state.bonusPhase === 'ending') {
                    state.bonusPhase = 'roulette';
                    state.bonusTicks = 0;
                    return { state, events };
                }
                const roulette = native.bonusRoulette[state.bonusTicks % 8];
                state.pendingScore += roulette;
                state.player.armored = false;
                state.player.jumpKind = 0;
                state.player.y = 176;
                state.ammo = 99;
                state.grenades = 9;
                if (state.screenIndex === 124) {
                    state.status = 'playing';
                    enterScreen(state, 0);
                    events.push({ type: 'won' });
                    events.push({ type: 'screen', value: 0 });
                } else {
                    state.status = 'playing';
                    advance(state, events);
                }
            }
            return { state, events };
        }
        if (state.player.invulnerableTicks > 0) state.player.invulnerableTicks--;
        if (state.player.deathTick < 15) {
            state.player.deathTick++;
            if (!state.lives && state.player.deathTick >= 15) {
                state.status = 'over';
                events.push({ type: 'over' });
            }
        }
        if (state.pendingScore > 0) {
            state.pendingScore--;
            state.score += 50;
        }
        updateProjectiles(state, events);
        updateEnemies(state, events);
        collisions(state, events);
        updatePistons(state);
        // Native $d3da runs before player control and stops at13; this is not an idle loop.
        state.teleportFrame = state.teleportPhase < 13 ? state.teleportPhase++ : -1;
        if (state.player.deathTick >= 15 && state.status === 'playing')
            movePlayer(state, command, events);
        if (
            state.player.x >= 190 &&
            state.screenIndex % 25 === 24 &&
            state.player.deathTick >= 15
        ) {
            state.status = 'bonus';
            state.bonusTicks = 0;
            state.bonusPhase = 'summary';
            state.pendingScore += (state.player.armored ? 0 : 200) + state.lives * 20;
            events.push({ type: 'bonus' });
        }
        state.entities = state.entities.filter((e) => e.alive);
        return { state, events };
    }

    return { createState: createNativeState, step: stepNative, overlap: nativeNativeOverlap };
}
