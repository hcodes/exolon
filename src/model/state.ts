// Native JavaScript rules translated from Raffaele Cecco / Sergey Erokhin (ESL).
// CC BY-SA 3.0; provenance and remaining timing limits: ../../research/behavior.md.
// X is in original two-pixel units (0..127); Y is in pixels. Events use pixels.
import {
    JUMP,
    DEATH_Y,
    GRENADE,
    SOLID,
    STAGE_START,
    DESTROYABLE,
    CHEAT_KEYS,
} from '../constants/rules.ts';
import { STAGE_SCREEN_COUNT } from '../constants/game.ts';
import type {
    Cheats,
    CreateStateOptions,
    Direction,
    FlyingEnemy,
    GameEvent,
    GameEventType,
    GameScreen,
    GameState,
    InputCommands,
    MapObject,
    RestartStateOptions,
    StepResult,
    World,
} from '../types/game.ts';

function emit(
    events: GameEvent[],
    type: GameEventType,
    x: number,
    y: number,
    detail: Partial<Omit<GameEvent, 'type' | 'x' | 'y'>> = {},
) {
    events.push({ type, x: x * 2, y, ...detail });
}

function random(state: GameState, accumulator = 0): number {
    state.seed = ((state.seed + 7) * 13) & 65535;
    return (accumulator ^ (state.seed >> 8)) & 255;
}

function addScore(state: GameState, points: number) {
    state.score = (state.score + points) % 1000000;
}

function objectsFor(screen: GameScreen): MapObject[] {
    if (screen.objects) return screen.objects;
    const objects: MapObject[] = (screen.tiles || []).flatMap((tile, offset) =>
        tile && tile.collision >= 2 && offset < 704
            ? [
                  {
                      id: offset,
                      type: tile.collision,
                      x: offset % 32,
                      y: offset >> 5,
                      instance: tile.instance,
                      block: tile.block,
                  },
              ]
            : [],
    );
    for (const action of screen.actions || [])
        objects.push({ ...action, id: action.y * 32 + action.x });
    return objects;
}

function initScreen(state: GameState) {
    state.screen = state.world.screens[state.screenIndex];
    state.stage = Math.floor(state.screenIndex / STAGE_SCREEN_COUNT) + 1;
    state.level = (state.screenIndex % STAGE_SCREEN_COUNT) + 1;
    state.screenTicks = 0;
    state.bullets = [];
    state.grenade = null;
    state.enemyBullets = [];
    state.rockets = [];
    state.spheres = [];
    state.enemies = [];
    state.killer = null;
    state.destroyed = [];
    state.enemyDelay = 0;
    state.objects = objectsFor(state.screen).map((object) => ({
        ...object,
        active: true,
        phase: object.type === 3 ? 2 : object.type === 10 ? 95 : 0,
        hits: 0,
        length: 0,
        yOffset: 0,
    }));
    for (const object of state.objects) {
        if (object.type === 9) {
            for (let i = 0; i < 8; i++)
                state.spheres.push({
                    x: object.x * 4 + 2,
                    y: object.y * 8 + 3,
                    dx: random(state) & 1 ? 1 : -1,
                    kind: 'sphere',
                });
        } else if (object.type === 17) {
            let row = object.y + 1;
            while (row < 22 && !collision(state, object.x, row, true)) row++;
            object.length = row - object.y - 1;
        }
    }
}

export function normalizeCheats(value: unknown = {}): Cheats {
    const settings =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    return Object.fromEntries(
        CHEAT_KEYS.map((key) => [key, value === true || settings[key] === true]),
    ) as Cheats;
}

export function setCheats(state: GameState, options: unknown): GameState {
    const cheats = normalizeCheats(options);
    const cheatMode = Object.values(cheats).some(Boolean);
    return { ...state, cheats, cheatMode, cheatUsed: state.cheatUsed || cheatMode };
}

export function createState(
    source: World | GameScreen,
    options: CreateStateOptions = {},
): GameState {
    const world = 'screens' in source ? source : { screens: [source], enemies: [] };
    const screenIndex = Math.max(
        0,
        Math.min(world.screens.length - 1, Math.trunc(options.screenIndex || 0)),
    );
    const start =
        screenIndex % STAGE_SCREEN_COUNT === 0
            ? STAGE_START[Math.floor(screenIndex / STAGE_SCREEN_COUNT)]
            : [0, 112];
    const [x, y] = start || STAGE_START[0];
    const state: GameState = {
        world,
        screenIndex,
        tick: 0,
        nextProjectileId: 1,
        screen: world.screens[screenIndex],
        stage: 1,
        level: 1,
        screenTicks: 0,
        bullets: [],
        grenade: null,
        enemyBullets: [],
        rockets: [],
        spheres: [],
        enemies: [],
        killer: null,
        destroyed: [],
        enemyDelay: 0,
        objects: [],
        cheats: normalizeCheats(),
        player: {
            x,
            y,
            direction: 1,
            jump: -1,
            walk: 1,
            duck: false,
            falling: false,
            sprite: 5,
            walkPhase: 0,
        },
        entrance: { x, y },
        ammo: 99,
        grenades: 10,
        lives: 9,
        score: 0,
        fireTicks: 0,
        exoskeleton: false,
        upHeld: false,
        turretPhase: 2,
        seed: 0x8eaa,
        death: 0,
        invulnerable: 0,
        bonus: null,
        status: 'playing',
        cheatMode: false,
        cheatUsed: false,
    };
    const configured = setCheats(state, options.cheats ?? options.cheatMode);
    initScreen(configured);
    return configured;
}

export function restartState(
    state: GameState,
    { initialScreen = 0, selectedScreen }: RestartStateOptions = {},
): GameState {
    const screenIndex =
        state.status === 'over' && state.cheats.retryLevel
            ? state.screenIndex
            : state.cheats.levelSelection
              ? (selectedScreen ?? initialScreen)
              : initialScreen;
    return createState(state.world, { screenIndex, cheats: state.cheats });
}

export function selectCheatScreen(state: GameState, index: number): GameState {
    if (!state.cheats.levelSelection || !Number.isFinite(index)) return state;
    const screenIndex = Math.max(0, Math.min(state.world.screens.length - 1, Math.trunc(index)));
    if (screenIndex === state.screenIndex) return state;
    const next = createState(state.world, { screenIndex, cheats: state.cheats });
    next.cheatUsed = state.cheatUsed;
    if (!['over', 'won'].includes(state.status)) {
        Object.assign(next, {
            score: state.score,
            lives: state.lives,
            ammo: state.ammo,
            grenades: state.grenades,
            exoskeleton: state.exoskeleton,
        });
    }
    return next;
}

function collision(state: GameState, column: number, row: number, ignoreBeam = false): number {
    if (column < 0 || column >= 32 || row < 0) return 1;
    if (row >= 22) return 0;
    if (
        !ignoreBeam &&
        state.objects?.some(
            (object) =>
                object.type === 17 &&
                object.active &&
                column === object.x &&
                row > object.y &&
                row <= object.y + object.length,
        )
    )
        return 1;
    const tile = state.screen.tiles[row * 32 + column];
    if (!tile || (tile.instance !== undefined && state.destroyed.includes(tile.instance))) return 0;
    return SOLID[tile.collision] || 0;
}

function canMove(state: GameState, direction: Direction, x = state.player.x, y = state.player.y) {
    const column = x >> 2;
    const row = y >> 3;
    if (direction === 'left' || direction === 'right') {
        if (direction === 'left' && x === 0) return false;
        if (direction === 'right' && x >= 116) return true;
        if (x & 3) return true;
        const target = column + (direction === 'left' ? -1 : 3);
        for (let i = 0; i < (y & 7 ? 5 : 4); i++) {
            if (collision(state, target, row + i)) return false;
        }
    } else {
        if (y & 7) return true;
        const target = row + (direction === 'up' ? -1 : 4);
        const width = x >= 116 ? 1 : x & 3 ? 4 : 3;
        for (let i = 0; i < width; i++) if (collision(state, column + i, target)) return false;
    }
    return true;
}

// The small-sprite routines have the original names: "up" checks the row below.
// Retaining this unusual rule matters to the original powered grenade trajectory.
function smallFree(state: GameState, direction: Direction, x: number, y: number) {
    if (direction === 'left' || direction === 'right') {
        if (x & 3) return true;
        const column = (x >> 2) + (direction === 'left' ? -1 : 1);
        return (
            !collision(state, column, y >> 3) &&
            (!(y & 7) || !collision(state, column, (y >> 3) + 1))
        );
    }
    if (y & 7) return true;
    const row = (y >> 3) + (direction === 'up' ? 1 : -1);
    return !collision(state, x >> 2, row) && (!(x & 3) || !collision(state, (x >> 2) + 1, row));
}

function movePlayer(state: GameState, input: InputCommands) {
    const p = state.player;
    p.sprite = 5;
    p.duck = false;
    if (p.jump >= 0 && !p.falling) {
        const dy = JUMP[p.jump++];
        if (dy && !canMove(state, dy < 0 ? 'up' : 'down')) p.jump = -1;
        else {
            p.sprite = 3;
            p.y += dy;
            if (p.jump === JUMP.length) p.jump = -1;
            if (p.walk && canMove(state, p.walk === 1 ? 'right' : 'left')) p.x += p.walk;
            return;
        }
    }
    if (canMove(state, 'down')) {
        p.y += 4;
        p.falling = true;
        p.sprite = 9;
        return;
    }
    p.falling = false;
    if (input.duck) {
        p.duck = true;
        p.sprite = 10;
        return;
    }
    if (input.jump && canMove(state, 'up')) {
        p.sprite = 3;
        p.jump = 1;
        p.y += JUMP[0];
        if (p.walk && canMove(state, p.walk === 1 ? 'right' : 'left')) p.x += p.walk;
        return;
    }
    p.walk = Boolean(input.left) === Boolean(input.right) ? 0 : input.left ? -1 : 1;
    if (!p.walk) return;
    if (p.direction !== p.walk) {
        p.direction = p.walk;
        return;
    }
    if (canMove(state, p.walk === 1 ? 'right' : 'left')) {
        p.x += p.walk;
        p.sprite = (p.walkPhase || 0) % 10;
        p.walkPhase = (p.sprite + 1) % 10;
    }
}

function inZone(state: GameState, x: number, y: number, width: number, height: number) {
    const p = state.player;
    const top = p.y + (p.duck ? 6 : 0);
    return p.x + 12 >= x && p.x < x + width && top + (p.duck ? 26 : 32) >= y && top < y + height;
}

function kill(state: GameState, events: GameEvent[], protectedBySuit = false) {
    if (
        state.cheats.invulnerable ||
        state.death ||
        state.invulnerable ||
        (protectedBySuit && state.exoskeleton)
    )
        return;
    state.player.y &= 0xfc;
    state.player.sprite = 11;
    state.death = 46;
    state.fireTicks = 0;
    state.screenTicks = 0;
    emit(events, 'death', state.player.x + 6, state.player.y + 12);
}

function removeInstance(state: GameState, instance: number | undefined) {
    if (instance !== undefined && !state.destroyed.includes(instance))
        state.destroyed.push(instance);
    for (const object of state.objects) if (object.instance === instance) object.active = false;
}

function interact(state: GameState, input: InputCommands, events: GameEvent[]) {
    const p = state.player;
    const pressed = input.jump && !state.upHeld;
    let usedUp = false;
    if (pressed) {
        const gates = state.objects.filter((object) => object.type === 6 && object.active);
        for (const object of state.objects) {
            if (!object.active || ![6, 12].includes(object.type)) continue;
            if (p.y !== (object.y + 1) * 8 || p.x < object.x * 4 - 12 || p.x > object.x * 4 + 8)
                continue;
            usedUp = true;
            if (object.type === 12) {
                state.exoskeleton = !state.exoskeleton;
                emit(events, 'suit', p.x, p.y, { enabled: state.exoskeleton });
            } else if (gates.length >= 2) {
                const other = gates[0] === object ? gates[1] : gates[0];
                emit(events, 'teleport', p.x + 4, p.y + 12);
                p.x = other.x * 4 - 3;
                p.y = (other.y + 1) * 8;
                p.jump = -1;
                p.falling = false;
                emit(events, 'teleport-arrive', p.x + 4, p.y + 12);
            }
            break;
        }
    }
    // Keep UP captured inside a chamber until released.
    if (
        input.jump &&
        state.upHeld &&
        state.objects.some(
            (object) =>
                object.active &&
                [6, 12].includes(object.type) &&
                p.y === (object.y + 1) * 8 &&
                p.x >= object.x * 4 - 12 &&
                p.x <= object.x * 4 + 8,
        )
    )
        usedUp = true;
    state.upHeld = Boolean(input.jump);
    for (const object of state.objects) {
        if (!object.active) continue;
        if (
            [7, 8].includes(object.type) &&
            p.y === (object.y - 2) * 8 &&
            p.x >= (object.x + 1) * 4 - 12 &&
            p.x < (object.x + 1) * 4
        ) {
            if (object.type === 7) state.ammo = 99;
            else state.grenades = 10;
            removeInstance(state, object.instance);
            emit(events, 'refill', object.x * 4, object.y * 8, {
                supply: object.type === 7 ? 'ammo' : 'grenades',
            });
        } else if (object.type === 14 && inZone(state, object.x * 4, object.y * 8, 4, 8)) {
            object.active = false;
            addScore(state, 1000);
            emit(events, 'bonus', object.x * 4, object.y * 8, { points: 1000 });
        }
    }
    return usedUp;
}

function fire(state: GameState, input: InputCommands, events: GameEvent[]) {
    const p = state.player;
    if (!input.fire || input.firePressed) state.fireTicks = 0;
    if (p.x >= 118) return;
    if (input.fire && !state.fireTicks && (state.cheats.infiniteAmmo || state.ammo > 0)) {
        if (!state.cheats.infiniteAmmo) state.ammo--;
        const x = p.x + (p.direction === 1 ? 12 : -4);
        const y = p.y + (p.duck ? 19 : 14);
        if (
            x >= 4 &&
            x < 120 &&
            !collision(state, x >> 2, y >> 3) &&
            !collision(state, (x >> 2) + 1, y >> 3)
        ) {
            state.bullets.push({ x, y, dx: p.direction });
            if (state.exoskeleton) state.bullets.push({ x, y: y + 6, dx: p.direction });
            state.bullets = state.bullets.slice(-8);
        }
        emit(events, 'shot', p.x + 6, y);
    }
    if (input.fire)
        state.fireTicks = input.chargeRocket === false ? 1 : Math.min(255, state.fireTicks + 1);
    if (
        (input.rocket || (input.chargeRocket !== false && state.fireTicks >= 15)) &&
        !state.grenade &&
        (state.cheats.infiniteRockets || state.grenades > 0)
    ) {
        if (!state.cheats.infiniteRockets) state.grenades--;
        state.grenade = {
            x: p.x + 4,
            y: p.y + (p.duck ? 6 : 0),
            dx: p.direction,
            phase: 32,
            projectileId: state.nextProjectileId++,
        };
        emit(events, 'grenade', p.x, p.y);
    }
}

function destroyFlying(state: GameState, enemy: FlyingEnemy, events: GameEvent[]) {
    addScore(state, 150);
    emit(events, 'enemy-destroyed', enemy.x + 4, enemy.y + 8, { points: 150 });
}

function updateBullets(state: GameState, events: GameEvent[]) {
    const p = state.player;
    state.bullets = state.bullets.filter((bullet) => {
        const enemyIndex = state.enemies.findIndex(
            (enemy) =>
                bullet.x >= enemy.x - 6 &&
                bullet.x < enemy.x + 2 &&
                bullet.y >= enemy.y - 1 &&
                bullet.y <= enemy.y + 16,
        );
        if (enemyIndex >= 0) {
            destroyFlying(state, state.enemies[enemyIndex], events);
            emit(events, 'hit', bullet.x, bullet.y, { weapon: 'bullet' });
            state.enemies.splice(enemyIndex, 1);
            return false;
        }
        for (const projectiles of [state.spheres, state.rockets]) {
            const index = projectiles.findIndex(
                (target) =>
                    target.kind !== 'homing' &&
                    bullet.x >= target.x - 2 &&
                    bullet.x < target.x + 2 &&
                    bullet.y >= target.y - 1 &&
                    bullet.y < target.y + 9,
            );
            if (index >= 0) {
                const [target] = projectiles.splice(index, 1);
                addScore(state, 50);
                emit(events, 'enemy-destroyed', target.x, target.y, { points: 50 });
                emit(events, 'hit', bullet.x, bullet.y, { weapon: 'bullet' });
                return false;
            }
        }
        const beam = state.objects.find(
            (object) => object.type === 17 && object.active && bullet.x === (object.x - 1) * 4,
        );
        const beamContact =
            beam &&
            bullet.dx === 1 &&
            bullet.y >= (beam.y + 1) * 8 &&
            bullet.y < (beam.y + 1 + beam.length) * 8;
        if (beam) {
            if (beamContact) emit(events, 'hit', bullet.x, bullet.y, { weapon: 'bullet' });
            beam.hits++;
            if (beam.hits >= 25) {
                beam.active = false;
                addScore(state, 1000);
                emit(events, 'explosion', beam.x * 4, (beam.y + 1) * 8, { points: 1000 });
            }
        }
        if (!smallFree(state, bullet.dx === 1 ? 'right' : 'left', bullet.x, bullet.y & -8)) {
            if (!beamContact && bullet.x > 1 && bullet.x < 124)
                emit(events, 'hit', bullet.x, bullet.y, { weapon: 'bullet' });
            return false;
        }
        if (
            bullet.x <= 1 ||
            bullet.x >= 124 ||
            bullet.x === ((p.x + 64) & 255) ||
            bullet.x === ((p.x - 52) & 255)
        )
            return false;
        bullet.x += bullet.dx;
        return true;
    });
}

function grenadeStep(state: GameState, events: GameEvent[]) {
    const g = state.grenade;
    if (!g) return;
    const dy = GRENADE[g.phase - 1];
    g.phase = Math.max(1, g.phase - 1);
    let impact = g.x > 0 && g.x < 124 && !smallFree(state, g.dx === 1 ? 'right' : 'left', g.x, g.y);
    let hit = g.x <= 0 || g.x >= 124 || impact;
    if (!hit) {
        g.x += g.dx;
        hit = dy !== -1 && !smallFree(state, 'up', g.x, g.y);
        impact = hit;
        if (!hit) {
            g.y = (g.y + dy) & 255;
            hit = g.y >= 168;
        }
    }
    if (!hit) return;
    const column = g.x >> 2;
    const row = g.y >> 3;
    for (const [index, item] of (state.screen.placements || []).entries()) {
        const size = DESTROYABLE[item.block];
        if (!size || state.destroyed.includes(index)) continue;
        const [dx, width, dyFrom, height] = size;
        if (
            column >= item.x + dx &&
            column < item.x + dx + width &&
            row >= item.y + dyFrom &&
            row < item.y + dyFrom + height
        ) {
            impact = true;
            removeInstance(state, index);
            addScore(state, 150);
            emit(events, 'object-destroyed', g.x, g.y, { instance: index, points: 150 });
            break;
        }
    }
    if (impact) emit(events, 'hit', g.x, g.y, { weapon: 'rocket' });
    emit(events, 'explosion', g.x, g.y);
    state.grenade = null;
}

function enemyBulletStep(state: GameState) {
    for (const bullet of state.enemyBullets) bullet.x += bullet.dx ?? -1;
    state.enemyBullets = state.enemyBullets.filter((bullet) => bullet.x >= 0 && bullet.x < 128);
}

function updateMachines(state: GameState, events: GameEvent[]) {
    for (const object of state.objects) {
        if (!object.active) continue;
        const x = object.x * 4;
        const y = object.y * 8;
        if (object.type === 3) {
            if (object.phase > 1) object.phase--;
            else if (random(state, 1) >= 250 && state.enemyBullets.length < 10) {
                object.phase = 9;
                state.enemyBullets.push({ x, y: y + 3, dx: -1 });
                emit(events, 'turret', x, y + 3);
            }
        } else if (
            object.type === 11 &&
            random(state) >= 247 &&
            state.player.x < x - 32 &&
            state.rockets.length < 10
        ) {
            state.rockets.push({
                x: x - 2,
                y,
                dx: -2,
                kind: 'launcher',
                projectileId: state.nextProjectileId++,
            });
            emit(events, 'rocket', x - 2, y);
        } else if (object.type === 10) {
            const phase = object.phase++;
            if (phase >= 101 && phase < 105) object.yOffset--;
            else if (phase >= 116 && phase < 120) object.yOffset++;
            else if (phase >= 120) object.phase = (random(state) & 63) + 20;
        } else if (
            object.type === 13 &&
            !state.rockets.some((rocket) => rocket.kind === 'homing')
        ) {
            state.rockets.push({
                x: 120,
                y: (random(state) & 127) + 32,
                dx: -1,
                kind: 'homing',
                instance: object.instance,
                projectileId: state.nextProjectileId++,
            });
        }
    }
}

function updateFlying(state: GameState) {
    const definition = state.world.enemies?.find((enemy) => enemy.screen === state.screenIndex);
    if (!state.death && definition) {
        if (state.enemyDelay) state.enemyDelay--;
        else if (state.player.x < 84 && state.enemies.length < 6 && random(state) >= 200) {
            const y =
                random(state) >= 175 ? state.player.y - 10 : state.player.y + (random(state) & 15);
            let color = random(state) & 7;
            if (color < 2) color += 4;
            state.enemies.push({
                x: 120,
                y,
                kind: 'flying',
                sprite: definition.sprite,
                color: color | 64,
                phase: 3,
                trajectory: definition.trajectory,
                trajectoryIndex: 0,
            });
            state.enemyDelay = definition.delay;
        }
    }
    for (const enemy of state.enemies) {
        const [dx, dy] = enemy.trajectory[enemy.trajectoryIndex];
        enemy.trajectoryIndex = (enemy.trajectoryIndex + 1) % enemy.trajectory.length;
        enemy.x += dx;
        enemy.y += dy;
        enemy.phase = (enemy.phase + 1) & 3;
    }
    state.enemies = state.enemies.filter(
        (enemy) => enemy.x >= 0 && enemy.x < 128 && enemy.y >= 0 && enemy.y < 176,
    );
}

function updateSpheres(state: GameState) {
    for (const sphere of state.spheres) {
        if (
            sphere.x <= 0 ||
            sphere.x >= 123 ||
            random(state) >= 220 ||
            !smallFree(state, sphere.dx === 1 ? 'right' : 'left', sphere.x, sphere.y)
        )
            sphere.dx = -sphere.dx;
        sphere.x += sphere.dx;
        const dy = random(state) & 1 ? 1 : -1;
        if (smallFree(state, dy === 1 ? 'up' : 'down', sphere.x, sphere.y)) sphere.y += dy;
        sphere.y = Math.max(1, Math.min(167, sphere.y));
    }
}

function updateRockets(state: GameState, events: GameEvent[]) {
    state.rockets = state.rockets.filter((rocket) => {
        if (
            rocket.kind === 'homing' &&
            rocket.instance !== undefined &&
            state.destroyed.includes(rocket.instance)
        ) {
            addScore(state, 850);
            emit(events, 'enemy-destroyed', rocket.x, rocket.y, { points: 850 });
            return false;
        }
        if (rocket.kind === 'homing') {
            rocket.x -= rocket.x < 70 ? 2 : 1;
            rocket.y += Math.sign(state.player.y - rocket.y);
        } else rocket.x += rocket.dx;
        return rocket.x >= 0;
    });
    if (!state.killer && state.screenTicks >= 700) state.killer = { x: 120, y: state.player.y };
    if (state.killer) {
        state.killer.x -= 2;
        if (state.killer.x < 0) state.killer = null;
    }
}

function updateCombat(state: GameState, events: GameEvent[], machines = true) {
    updateBullets(state, events);
    enemyBulletStep(state);
    grenadeStep(state, events);
    updateBullets(state, events);
    updateSpheres(state);
    updateBullets(state, events);
    if (state.grenade && state.grenade.phase < 19) grenadeStep(state, events);
    updateBullets(state, events);
    enemyBulletStep(state);
    if (machines) updateMachines(state, events);
    updateBullets(state, events);
    if (state.grenade && state.grenade.phase < 19) grenadeStep(state, events);
    updateRockets(state, events);
    updateFlying(state);
}

function hazards(state: GameState, events: GameEvent[]) {
    const p = state.player;
    for (const object of state.objects) {
        if (!object.active) continue;
        if (
            object.type === 5 &&
            p.y + 31 === object.y * 8 - 1 &&
            p.x + 6 >= object.x * 4 - 1 &&
            p.x + 6 <= object.x * 4 + 8
        ) {
            object.active = false;
            emit(events, 'mine', object.x * 4, object.y * 8);
            kill(state, events, true);
        } else if (
            object.type === 10 &&
            object.phase >= 101 &&
            inZone(state, object.x * 4, (object.y + object.yOffset) * 8, 12, 32)
        )
            kill(state, events, true);
        else if (object.type === 17 && p.x + 12 === object.x * 4) kill(state, events);
    }
    state.enemyBullets = state.enemyBullets.filter((bullet) => {
        if (!inZone(state, bullet.x, bullet.y, 0, 0)) return true;
        kill(state, events);
        return false;
    });
    state.spheres = state.spheres.filter((sphere) => {
        if (!inZone(state, sphere.x, sphere.y, 4, 8)) return true;
        addScore(state, 50);
        emit(events, 'enemy-destroyed', sphere.x, sphere.y, { points: 50 });
        kill(state, events);
        return false;
    });
    state.rockets = state.rockets.filter((rocket) => {
        const homing = rocket.kind === 'homing';
        if (!inZone(state, rocket.x, rocket.y, homing ? 8 : 4, homing ? 16 : 8)) return true;
        if (!homing) addScore(state, 50);
        emit(events, 'explosion', rocket.x, rocket.y);
        kill(state, events);
        return false;
    });
    state.enemies = state.enemies.filter((enemy) => {
        if (!inZone(state, enemy.x + 2, enemy.y + 4, 4, 8)) return true;
        destroyFlying(state, enemy, events);
        kill(state, events);
        return false;
    });
    if (state.killer && inZone(state, state.killer.x, state.killer.y, 8, 16)) kill(state, events);
    if (p.y > 176) {
        if (state.cheats.invulnerable)
            Object.assign(p, state.entrance, {
                jump: -1,
                falling: false,
                duck: false,
                sprite: 5,
                walkPhase: 0,
            });
        else kill(state, events);
    }
}

function advance(state: GameState, events: GameEvent[], stageEnd: boolean, bonusConfirmed = false) {
    if (stageEnd && !bonusConfirmed) {
        const lifePoints = state.lives * 1000;
        const braveryPoints = state.exoskeleton ? 0 : 10000;
        state.bonus = {
            cursor: state.bonus?.cursor || 0,
            armed: false,
            base: lifePoints,
            lives: state.lives,
            bravery: braveryPoints,
            lifePoints,
            braveryPoints,
            total: lifePoints + braveryPoints,
        };
        addScore(state, state.bonus.total);
        emit(events, 'stage', state.player.x, state.player.y, {
            stage: state.stage,
            ...state.bonus,
        });
    }
    if (state.screenIndex + 1 >= state.world.screens.length) {
        state.status = 'won';
        emit(events, 'victory', state.player.x, state.player.y);
        return;
    }
    if (stageEnd && !bonusConfirmed) {
        state.status = 'bonus';
        return;
    }
    state.screenIndex++;
    if (stageEnd) {
        state.lives = Math.min(9, state.lives + 1);
        state.ammo = 99;
        state.grenades = 10;
        state.exoskeleton = false;
        state.fireTicks = 0;
        const [x, y] = STAGE_START[Math.floor(state.screenIndex / STAGE_SCREEN_COUNT)] || [0, 112];
        Object.assign(state.player, { x, y, jump: -1, falling: false });
    } else state.player.x = 0;
    state.entrance = { x: state.player.x, y: state.player.y };
    initScreen(state);
    emit(events, 'screen', state.player.x, state.player.y, {
        screenIndex: state.screenIndex,
        stage: state.stage,
        level: state.level,
    });
}

function respawn(state: GameState, events: GameEvent[]) {
    if (!state.cheats.infiniteLives) state.lives--;
    if (!state.lives) {
        state.status = 'over';
        emit(events, 'game-over', state.player.x, state.player.y);
        return;
    }
    Object.assign(state.player, state.entrance, {
        jump: -1,
        falling: false,
        direction: 1,
        walk: 1,
        duck: false,
        sprite: 5,
        walkPhase: 0,
    });
    while (state.player.y < 176 && canMove(state, 'down')) state.player.y++;
    state.ammo = 99;
    state.grenades = 10;
    state.fireTicks = 0;
    state.invulnerable = 20;
    state.bullets = [];
    state.grenade = null;
    emit(events, 'respawn', state.player.x, state.player.y);
}

export function step(previous: GameState, input: InputCommands = {}): StepResult {
    if (previous.status === 'bonus') {
        const state: GameState = {
            ...previous,
            tick: previous.tick + 1,
            bonus: { ...previous.bonus!, cursor: (previous.bonus!.cursor + 1) & 7 },
        };
        const events: GameEvent[] = [];
        const bonus = state.bonus!;
        if (!input.fire) bonus.armed = true;
        else if (bonus.armed) {
            const points = [0, 1000, 0, 3000, 0, 5000, 0, 7000][bonus.cursor];
            bonus.total += points;
            bonus.roulette = points;
            addScore(state, points);
            emit(events, 'bonus', state.player.x, state.player.y, { points, cursor: bonus.cursor });
            state.player = { ...previous.player };
            state.status = 'playing';
            advance(state, events, true, true);
        }
        return { state, events };
    }
    if (previous.status !== 'playing') return { state: previous, events: [] };
    const state: GameState = {
        ...previous,
        tick: previous.tick + 1,
        screenTicks: previous.screenTicks + 1,
        player: { ...previous.player },
        entrance: { ...previous.entrance },
        bullets: previous.bullets.map((bullet) => ({ ...bullet })),
        enemyBullets: previous.enemyBullets.map((bullet) => ({ ...bullet })),
        objects: previous.objects.map((object) => ({ ...object })),
        enemies: previous.enemies.map((enemy) => ({ ...enemy })),
        rockets: previous.rockets.map((rocket) => ({ ...rocket })),
        spheres: previous.spheres.map((sphere) => ({ ...sphere })),
        killer: previous.killer ? { ...previous.killer } : null,
        grenade: previous.grenade ? { ...previous.grenade } : null,
        destroyed: [...previous.destroyed],
    };
    const events: GameEvent[] = [];
    if (state.invulnerable) state.invulnerable--;
    if (state.death) {
        const remaining = state.death;
        state.death--;
        if (!state.death) respawn(state, events);
        else {
            const dy = DEATH_Y[remaining - 1];
            if (dy < 0 || canMove(state, 'down')) state.player.y = (state.player.y + dy) & 255;
        }
        // Already launched weapons keep their normal movement and collision cadence.
        if (state.death) updateCombat(state, events, false);
        else {
            enemyBulletStep(state);
            enemyBulletStep(state);
            updateFlying(state);
            updateSpheres(state);
            updateRockets(state, events);
        }
        return { state, events };
    }
    const usedUp = interact(state, input, events);
    movePlayer(state, usedUp ? { ...input, jump: false } : input);
    if (state.player.x >= 128) {
        advance(state, events, state.screenIndex % STAGE_SCREEN_COUNT === STAGE_SCREEN_COUNT - 1);
        return { state, events };
    }
    fire(state, input, events);
    updateCombat(state, events);
    const stageGate = state.objects.find((object) => object.type === 16 && object.active);
    if (stageGate && state.player.x >= stageGate.x * 4) {
        advance(state, events, true);
        return { state, events };
    }
    hazards(state, events);
    return { state, events };
}
