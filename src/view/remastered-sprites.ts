import type { MotionSnapshot, HeroFrame } from '../types/graphics.ts';
import type { GameState, GameEvent, FlyingEnemy, ScreenObject } from '../types/game.ts';
import type {
    CanvasPaint,
    VectorPath,
    Palette,
    Point,
    Graphics,
    SpriteEffect,
    SpriteDebris,
    Departure,
} from '../types/graphics.ts';
// Presentation only. Source positions, collision boxes, artwork and randomness
// remain owned by the original model and Retro renderer.
import { drawAstronaut } from './astronaut.ts';
import { getHeroPose, getJetpackThrust } from './hero-motion.ts';
import { drawFlyingSpacecraft } from './flying-spacecraft.ts';
import { createProjectileMotion } from './projectile-motion.ts';
import { createRocketTrail, rocketGeometry, rocketNozzle } from './rocket-trail.ts';
import { createTeleportMotion } from './teleport-motion.ts';
import { spectrumPalette } from './palette.ts';

const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const noise = (seed: number) => {
    let value = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
};

function ellipse(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: CanvasPaint,
    rotation = 0,
) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rotation, 0, TAU);
    c.fillStyle = color;
    c.fill();
}

function line(c: CanvasRenderingContext2D, points: VectorPath, color: CanvasPaint, width = 0.45) {
    c.beginPath();
    points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
}

function polygon(
    c: CanvasRenderingContext2D,
    points: VectorPath,
    color: CanvasPaint,
    stroke: string | null = '#172b3a',
) {
    c.beginPath();
    points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = color;
    c.fill();
    if (stroke) {
        c.strokeStyle = stroke;
        c.lineWidth = 0.45;
        c.stroke();
    }
}

function metal(c: CanvasRenderingContext2D, palette: Palette, top = -7, bottom = 7) {
    const fill = c.createLinearGradient(-4, top, 4, bottom);
    fill.addColorStop(0, palette.highlight);
    fill.addColorStop(0.3, palette.light);
    fill.addColorStop(0.6, palette.base);
    fill.addColorStop(1, palette.shade);
    return fill;
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
    const fill = c.createRadialGradient(x, y, 0, x, y, radius);
    fill.addColorStop(0, color);
    fill.addColorStop(1, '#00000000');
    ellipse(c, x, y, radius, radius, fill);
}

function flyingEnemy(
    c: CanvasRenderingContext2D,
    enemy: FlyingEnemy,
    time: number,
    fraction: number,
) {
    const palette = spectrumPalette(enemy.color ?? 69);
    const frame = Math.floor(time / 70) & 3;
    if (drawFlyingSpacecraft(c, enemy.sprite, palette, frame)) return;
    const fill = metal(c, palette);
    const beat = Math.sin(time * 0.018 + enemy.y);
    if (enemy.sprite === 16) {
        // Source frames16..19 are colored circles with radii8/7/6/7.
        // Interpolate the model's animation phase with the same clock as flight.
        const phase = ((enemy.phase ?? 0) + 3) & 3,
            radii = [7.8, 6.8, 5.8, 6.8];
        const radius = mix(radii[(phase + 3) & 3], radii[phase], fraction);
        const squash = Math.sin(((phase - 1 + fraction) * Math.PI) / 2) * 0.025;
        const rx = radius * (1 + squash),
            ry = radius * (1 - squash);
        const surface = c.createRadialGradient(
            -radius * 0.34,
            -radius * 0.4,
            0.1,
            radius * 0.15,
            radius * 0.18,
            radius * 1.08,
        );
        surface.addColorStop(0, palette.highlight);
        surface.addColorStop(0.24, palette.light);
        surface.addColorStop(0.57, palette.base);
        surface.addColorStop(0.85, palette.shade);
        surface.addColorStop(1, palette.deep);
        ellipse(c, 0, 0, rx, ry, surface);
        c.strokeStyle = palette.deep;
        c.lineWidth = 0.3;
        c.stroke();
        c.beginPath();
        c.ellipse(
            -radius * 0.05,
            -radius * 0.05,
            rx * 0.76,
            ry * 0.76,
            0,
            Math.PI * 1.08,
            Math.PI * 1.58,
        );
        c.strokeStyle = `${palette.light}99`;
        c.lineWidth = 0.35;
        c.stroke();
    } else if (enemy.sprite === 24) {
        // Soft alien bell with waving tendrils, distinct from the metal ships.
        for (let index = 0; index < 5; index++) {
            const x = -5 + index * 2.3;
            c.beginPath();
            c.moveTo(x, 1);
            c.bezierCurveTo(x + beat * 2, 4, x - beat, 5, x + Math.sin(time * 0.013 + index), 7.5);
            c.strokeStyle = index & 1 ? palette.light : palette.shade;
            c.lineWidth = 0.85;
            c.stroke();
        }
        ellipse(c, 0, -1.8, 7, 4.6, fill);
        ellipse(c, -1.1, -2.3, 4.3, 2.1, palette.deep);
        ellipse(c, -2, -2.4, 2.6, 1.45, '#93f2dd');
        ellipse(c, -2.7, -2.5, 0.7, 0.95, '#132e42');
        line(
            c,
            [
                [-5, -4],
                [-2, -5.1],
                [0.5, -4.8],
            ],
            palette.highlight,
            0.65,
        );
        for (const x of [-4, 0, 4]) ellipse(c, x, 1.4, 0.6, 0.5, palette.highlight);
    } else if (enemy.sprite === 37) {
        // A four-bladed turbine with an independently rotating central rotor.
        c.save();
        c.rotate(time * 0.004);
        for (let index = 0; index < 4; index++) {
            c.rotate(Math.PI / 2);
            polygon(
                c,
                [
                    [0, -2],
                    [-3, -6.5],
                    [-0.3, -7.5],
                    [3.6, -4.2],
                    [2.5, -0.5],
                ],
                fill,
            );
            line(
                c,
                [
                    [-0.7, -6.4],
                    [2.7, -4.1],
                ],
                palette.highlight,
            );
        }
        c.restore();
        ellipse(c, 0, 0, 3.7, 3.7, palette.deep);
        ellipse(c, -0.3, -0.4, 2.6, 2.6, fill);
        ellipse(c, -0.8, -0.8, 1, 1, '#b7fbff');
    } else {
        // The final family is a narrow armoured interceptor with split fins.
        for (const side of [-1, 1]) {
            polygon(
                c,
                [
                    [-2, side],
                    [3.5, side * 6.9],
                    [6.4, side * 7.1],
                    [4.2, side * 1.5],
                ],
                fill,
            );
            line(
                c,
                [
                    [1, side * 2.8],
                    [4.8, side * 5.9],
                ],
                palette.highlight,
            );
        }
        polygon(
            c,
            [
                [-7.7, 0],
                [-3.8, -2.6],
                [4.5, -2.5],
                [7.2, 0],
                [4.5, 2.5],
                [-3.8, 2.6],
            ],
            fill,
        );
        polygon(
            c,
            [
                [-4.4, 0],
                [-1.2, -1.5],
                [1.3, -1.2],
                [0.5, 0.7],
            ],
            palette.deep,
        );
        line(
            c,
            [
                [-3.2, -0.4],
                [-1.1, -0.8],
            ],
            '#c8ffff',
            0.65,
        );
        ellipse(c, 5.5, 0, 0.8, 1.5, '#ffb979');
    }
}

function rocket(
    c: CanvasRenderingContext2D,
    pose: Point & { angle: number },
    time: number,
    homing = false,
    player = false,
) {
    c.save();
    const { offset, length } = rocketGeometry(homing);
    c.translate(pose.x + offset, pose.y + offset);
    c.rotate(pose.angle || 0);
    glow(c, -length, 0, 4, '#ff93365c');
    const flame = 3.3 + Math.sin(time * 0.045) * 0.6;
    polygon(
        c,
        [
            [-length + 1, -1],
            [-length - flame, 0],
            [-length + 1, 1],
        ],
        '#ffb84f',
        null,
    );
    polygon(
        c,
        [
            [-length + 0.5, -0.5],
            [-length - flame * 0.7, 0],
            [-length + 0.5, 0.5],
        ],
        '#fff3b5',
        null,
    );
    const palette = spectrumPalette(player || homing ? 71 : 70);
    if (homing) {
        // Original frames10/11 switch at model x<70. Open over the next
        // eight display pixels, using the interpolated position for continuity.
        const opened = clamp((140 - pose.x) / 8),
            span = 3 + 4.2 * opened;
        for (const side of [-1, 1]) {
            polygon(
                c,
                [
                    [-6.8, side * 1.4],
                    [-6.8, side * span],
                    [-5.1, side * span],
                    [-2.9, side * 3],
                    [-3.3, side * 1.4],
                ],
                metal(c, palette, -span, span),
            );
            line(
                c,
                [
                    [-6.2, side * (span - 0.4)],
                    [-5.4, side * (span - 0.4)],
                    [-3.6, side * 2.6],
                ],
                palette.highlight,
                0.35,
            );
            ellipse(c, -5.8, side * 1.65, 0.45, 0.45, palette.deep);
        }
    }
    polygon(
        c,
        [
            [length, 0],
            [length - 2.3, -1.6],
            [-length + 1, -1.5],
            [-length, -3],
            [-length + 2, 0],
            [-length, 3],
            [-length + 1, 1.5],
            [length - 2.3, 1.6],
        ],
        metal(c, palette, -2, 2),
    );
    line(
        c,
        [
            [-length + 2, -0.8],
            [length - 2.8, -0.8],
        ],
        palette.highlight,
        0.4,
    );
    if (homing) {
        ellipse(c, 2, -0.3, 1.1, 1.1, '#f9567c');
        line(
            c,
            [
                [-3, -1.6],
                [-3, 1.6],
            ],
            palette.deep,
        );
    }
    c.restore();
}

function sphere(c: CanvasRenderingContext2D, x: number, y: number, time: number, killer = false) {
    c.save();
    c.translate(x, y);
    const radius = killer ? 7 : 3.7;
    const palette = spectrumPalette(killer ? 67 : 66);
    glow(c, 0, 0, radius * 1.7, killer ? '#fa5ce53a' : '#ff67773d');
    const fill = c.createRadialGradient(-radius * 0.35, -radius * 0.4, 0.2, 0, 0, radius);
    fill.addColorStop(0, palette.highlight);
    fill.addColorStop(0.4, palette.base);
    fill.addColorStop(1, palette.deep);
    ellipse(c, 0, 0, radius, radius, fill);
    c.save();
    c.rotate(time * 0.003);
    c.beginPath();
    c.ellipse(0, 0, radius * 0.5, radius, -0.45, 0, TAU);
    c.strokeStyle = palette.light;
    c.lineWidth = 0.5;
    c.stroke();
    if (killer) {
        for (let index = 0; index < 6; index++) {
            c.rotate(TAU / 6);
            polygon(
                c,
                [
                    [radius - 1, -1],
                    [radius + 1, 0],
                    [radius - 1, 1],
                ],
                palette.light,
            );
        }
    }
    c.restore();
    ellipse(c, -radius * 0.3, -radius * 0.4, radius * 0.2, radius * 0.13, '#fff9ed');
    c.restore();
}

function mineFire(c: CanvasRenderingContext2D, mine: ScreenObject, time: number) {
    const phase = time * 0.018 + mine.id * 1.7;
    const height = 6.5 + Math.sin(phase) * 0.6 + Math.sin(phase * 1.83) * 0.3,
        sway = Math.sin(phase * 0.9) * 0.5;
    c.save();
    c.translate(mine.x * 8 + 8, mine.y * 8 - 4.6);
    glow(c, 0, -height * 0.4, 3.6, '#ffbc493d');
    const fire = c.createLinearGradient(0, 0, 0, -height);
    fire.addColorStop(0, '#fffbe5');
    fire.addColorStop(0.18, '#fff18e');
    fire.addColorStop(0.48, '#ffc64c');
    fire.addColorStop(0.75, '#ff7a27');
    fire.addColorStop(1, '#ef382600');
    c.beginPath();
    c.moveTo(-1.7, 0);
    c.bezierCurveTo(-2.6, -height * 0.3, sway - 1, -height * 0.62, sway, -height);
    c.bezierCurveTo(sway + 0.4, -height * 0.65, 2.5, -height * 0.28, 1.7, 0);
    c.closePath();
    c.fillStyle = fire;
    c.fill();
    const core = c.createLinearGradient(0, 0, 0, -height * 0.7);
    core.addColorStop(0, '#fffef2');
    core.addColorStop(0.4, '#fffbd0');
    core.addColorStop(1, '#ffe38100');
    c.beginPath();
    c.moveTo(-0.7, 0);
    c.quadraticCurveTo(-0.9, -height * 0.3, sway * 0.4, -height * 0.7);
    c.quadraticCurveTo(1, -height * 0.25, 0.7, 0);
    c.closePath();
    c.fillStyle = core;
    c.fill();
    c.restore();
}

export function createRemasteredSprites(graphics: Graphics) {
    const projectiles = createProjectileMotion();
    const trails = createRocketTrail();
    const teleport = createTeleportMotion();
    let snapshot: MotionSnapshot | undefined, hero: HeroFrame | undefined;
    let phase = 0;
    let effects: SpriteEffect[] = [],
        debris: SpriteDebris[] = [];
    let consumed = new WeakSet();

    function reset() {
        snapshot = hero = undefined;
        phase = 0;
        effects = [];
        debris = [];
        consumed = new WeakSet();
        projectiles.reset();
        trails.reset();
        teleport.reset();
    }

    function observe(state: GameState, events: GameEvent[] = []) {
        if (!state?.player) return;
        if (
            snapshot &&
            snapshot.tick === state.tick &&
            snapshot.screen === state.screenIndex &&
            consumed.has(events)
        )
            return;
        const changed =
            !snapshot || state.tick !== snapshot.tick || state.screenIndex !== snapshot.screen;
        const discontinuity =
            !snapshot ||
            state.tick < snapshot.tick ||
            state.screenIndex !== snapshot.screen ||
            events.some((event) => ['respawn', 'screen', 'stage'].includes(event.type));
        if (discontinuity) {
            effects = [];
            debris = [];
            phase = 0;
            hero = undefined;
            consumed = new WeakSet();
            projectiles.reset();
            trails.reset();
            teleport.reset();
        }
        if (changed) {
            const p = state.player;
            const continuous =
                snapshot &&
                !discontinuity &&
                state.tick === snapshot.tick + 1 &&
                Math.abs(p.x * 2 - snapshot.x) <= 8 &&
                Math.abs(p.y - snapshot.y) <= 12;
            const distance = continuous ? Math.abs(p.x * 2 - snapshot!.x) : 0;
            const walking = !state.death && !p.duck && !p.falling && p.jump < 0 && distance > 0;
            const previousPhase = phase;
            if (walking) phase += distance / 20;
            hero = {
                x: p.x * 2,
                y: p.y,
                fromX: continuous ? snapshot!.x : p.x * 2,
                fromY: continuous ? snapshot!.y : p.y,
                fromPhase: previousPhase,
                phase,
                walking,
            };
            snapshot = { tick: state.tick, screen: state.screenIndex, x: p.x * 2, y: p.y };
            effects = effects.filter((effect) => state.tick - effect.tick < effect.life);
            debris = debris.filter((piece) => state.tick - piece.tick < 34);
        }
        projectiles.observe(state, events);
        const poses = projectiles.sample(state, 1);
        // The original boost particles are emitted only while phase >= 19.
        const exhaust =
            state.grenade && state.grenade.phase >= 19 && poses.grenade
                ? [
                      {
                          id: `player:${state.grenade.projectileId ?? 0}`,
                          ...rocketNozzle(poses.grenade),
                      },
                  ]
                : [];
        trails.observe(state.tick, state.screenIndex, exhaust);
        teleport.observe(state, events);
        if (consumed.has(events)) return;
        consumed.add(events);
        for (const event of events) {
            if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
            const seed = (state.tick * 127 + event.x * 31 + event.y) | 0;
            if (
                [
                    'explosion',
                    'enemy-destroyed',
                    'death',
                    'hit',
                    'shot',
                    'turret',
                    'teleport',
                    'teleport-arrive',
                    'suit',
                    'refill',
                    'bonus',
                ].includes(event.type)
            ) {
                effects.push({
                    type: event.type,
                    x: event.x,
                    y: event.y,
                    tick: state.tick,
                    seed,
                    life: event.type.startsWith('teleport')
                        ? 20
                        : ['shot', 'turret'].includes(event.type)
                          ? 3
                          : 14,
                });
            }
            if (event.type !== 'object-destroyed') continue;
            effects.push({
                type: 'explosion',
                x: event.x,
                y: event.y,
                tick: state.tick,
                seed,
                life: 17,
            });
            for (const [index, tile] of (state.screen?.tiles || []).entries()) {
                if (!tile || tile.instance !== event.instance || index >= 704 || tile.ink === false)
                    continue;
                const bitmap = graphics?.shapes?.[tile.shape!];
                for (let half = 0; half < 2; half++) {
                    const salt = seed + index * 7 + half;
                    const x = (index % 32) * 8 + half * 4,
                        y = (index >> 5) * 8;
                    debris.push({
                        x,
                        y,
                        color: tile.color ?? 71,
                        bitmap,
                        half,
                        tick: state.tick,
                        vx: (x - event.x) * 1.2 + (noise(salt) - 0.5) * 45,
                        vy: -23 - noise(salt + 1) * 40,
                        spin: (noise(salt + 2) - 0.5) * 9,
                    });
                }
            }
        }
        effects = effects.slice(-90);
        debris = debris.slice(-100);
    }

    function drawHero(
        c: CanvasRenderingContext2D,
        state: GameState,
        time: number,
        amount: number,
        opacity = 1,
        departure: Departure | null = null,
    ) {
        if (!state.player || !hero || opacity <= 0) return;
        const p = state.player;
        if (!departure && state.invulnerable && state.tick & 2) return;
        const kind =
            state.death || state.status === 'over'
                ? 'death'
                : p.duck
                  ? 'crouch'
                  : p.falling
                    ? 'fall'
                    : p.jump >= 0
                      ? 'jump'
                      : hero.walking
                        ? 'walk'
                        : 'idle';
        const pose = getHeroPose(
            departure ? 'idle' : kind,
            mix(hero.fromPhase, hero.phase, amount),
        );
        c.save();
        c.globalAlpha *= opacity;
        const x = departure ? departure.x : mix(hero.fromX, hero.x, amount);
        const y = departure ? departure.y : mix(hero.fromY, hero.y, amount);
        c.translate(x + 12, y + 16);
        c.scale((departure?.direction ?? p.direction ?? 1) < 0 ? -1 : 1, 1);
        drawAstronaut(c, pose, {
            armored: departure?.armored ?? Boolean(state.exoskeleton),
            death: !departure && Boolean(state.death),
            thrust: departure ? 0 : getJetpackThrust(state, amount),
            timeMs: time,
        });
        c.restore();
    }

    function drawEffects(c: CanvasRenderingContext2D, state: GameState, amount: number) {
        const tick = state.tick + amount;
        for (const effect of effects) {
            const age = tick - effect.tick;
            if (age < 0 || age >= effect.life) continue;
            const fade = 1 - age / effect.life;
            c.save();
            c.globalAlpha *= fade;
            const teleporting = effect.type.startsWith('teleport');
            const muzzle = effect.type === 'shot' || effect.type === 'turret';
            const supply = ['suit', 'refill', 'bonus'].includes(effect.type);
            const small = effect.type === 'hit' || muzzle;
            const color = teleporting || supply ? '#8affed' : '#ffd386';
            glow(c, effect.x, effect.y, (small ? 4 : 9) + age * 0.4, `${color}70`);
            if (teleporting || supply) {
                for (let index = 0; index < 13; index++) {
                    const x = effect.x + (noise(effect.seed + index) - 0.5) * 16;
                    const y = effect.y - 12 + noise(effect.seed + index + 31) * 32 - age * 0.5;
                    line(
                        c,
                        [
                            [x, y],
                            [x, y + 2 + fade * 3],
                        ],
                        color,
                        0.5,
                    );
                }
            } else {
                for (let index = 0; index < (small ? 5 : 11); index++) {
                    const angle = noise(effect.seed + index * 3) * TAU;
                    const radius = age * (0.65 + noise(effect.seed + index * 3 + 1) * 0.8);
                    const x = effect.x + Math.cos(angle) * radius;
                    const y = effect.y + Math.sin(angle) * radius + age * age * 0.025;
                    line(
                        c,
                        [
                            [x, y],
                            [
                                x + Math.cos(angle) * (1 + fade * 2),
                                y + Math.sin(angle) * (1 + fade * 2),
                            ],
                        ],
                        index & 1 ? color : '#ff8759',
                        0.5 + fade * 0.5,
                    );
                }
                if (age < 4)
                    ellipse(
                        c,
                        effect.x,
                        effect.y,
                        (small ? 1.5 : 4) * (1 - age / 4),
                        (small ? 1 : 3) * (1 - age / 4),
                        '#fff5d3',
                    );
            }
            c.restore();
        }
        for (const piece of debris) {
            const age = tick - piece.tick;
            if (age < 0 || age >= 34) continue;
            const seconds = age / 30;
            const palette = spectrumPalette(piece.color);
            c.save();
            c.globalAlpha *= clamp((34 - age) / 10);
            c.translate(
                piece.x + 2 + piece.vx * seconds,
                piece.y + 4 + piece.vy * seconds + 90 * seconds * seconds,
            );
            c.rotate(piece.spin * seconds);
            // Keep each recovered half-cell silhouette as shaded falling metal.
            c.fillStyle = metal(c, palette, -4, 4);
            if (piece.bitmap) {
                for (let row = 0; row < 8; row++)
                    for (let col = 0; col < 4; col++) {
                        if (piece.bitmap[row] & (128 >> (col + piece.half * 4)))
                            c.fillRect(col - 2, row - 4, 1, 1);
                    }
            } else c.fillRect(-2, -3, 4, 6);
            c.restore();
        }
    }

    return {
        observe,
        draw(c: CanvasRenderingContext2D, state: GameState, visualTimeMs = 0, fraction = 0) {
            if (!state?.player) return;
            if (!snapshot || snapshot.tick !== state.tick || snapshot.screen !== state.screenIndex)
                observe(state);
            const amount = clamp(fraction);
            const time = Number.isFinite(visualTimeMs) ? visualTimeMs : 0;
            c.save();
            c.beginPath();
            c.rect(0, 0, 256, 176);
            c.clip();
            c.lineCap = 'round';
            c.lineJoin = 'round';
            for (const puff of trails.sample(state.tick, amount)) {
                c.save();
                c.globalAlpha *= puff.opacity;
                ellipse(
                    c,
                    puff.x,
                    puff.y,
                    puff.radius * 1.35,
                    puff.radius,
                    puff.hot ? '#ffe1a0' : '#b6b6c4',
                );
                c.restore();
            }
            const teleportPose = teleport.sample(state, amount);
            if (teleportPose)
                drawHero(
                    c,
                    state,
                    time,
                    amount,
                    teleportPose.departure.opacity,
                    teleportPose.departure,
                );
            drawHero(c, state, time, amount, teleportPose?.arrivalOpacity ?? 1);
            for (const enemy of state.enemies || []) {
                const trajectory = enemy.trajectory || [];
                const delta = trajectory[
                    (enemy.trajectoryIndex + trajectory.length - 1) % trajectory.length
                ] || [0, 0];
                c.save();
                c.translate(
                    enemy.x * 2 + 8 - delta[0] * 2 * (1 - amount),
                    enemy.y + 8 - delta[1] * (1 - amount),
                );
                flyingEnemy(c, enemy, time, amount);
                c.restore();
            }
            for (const item of state.spheres || []) sphere(c, item.x * 2 + 4, item.y + 4, time);
            if (state.killer) sphere(c, state.killer.x * 2 + 8, state.killer.y + 8, time, true);
            const poses = projectiles.sample(state, amount);
            if (poses.grenade) rocket(c, poses.grenade, time, false, true);
            (state.rockets || []).forEach((item, index) =>
                rocket(c, poses.rockets[index], time, item.kind === 'homing'),
            );
            for (const item of state.bullets || []) {
                const x = item.x * 2,
                    dx = item.dx || 1;
                glow(c, x + 3, item.y, 3.5, '#fff2b22d');
                line(
                    c,
                    [
                        [x - dx * 3, item.y],
                        [x + dx * 5, item.y],
                    ],
                    '#ffb84b',
                    1.25,
                );
                line(
                    c,
                    [
                        [x, item.y],
                        [x + dx * 5, item.y],
                    ],
                    '#fff8d1',
                    0.55,
                );
            }
            for (const item of state.enemyBullets || []) {
                glow(c, item.x * 2 + 1, item.y + 1, 3.5, '#ff735858');
                ellipse(c, item.x * 2 + 1, item.y + 1, 1.15, 0.9, '#ffdcc1');
            }
            // A spent mine keeps its small flame until the model resets it.
            // It comes from object state, so graphics switches cannot erase it.
            for (const mine of state.objects || [])
                if (
                    mine.type === 5 &&
                    !mine.active &&
                    !(state.destroyed || []).includes(mine.instance!)
                )
                    mineFire(c, mine, time);
            drawEffects(c, state, amount);
            c.restore();
        },
        reset,
    };
}
