import { createAmigaGameStar } from '../../amiga/view/game-stars.ts';
import { createAmigaMenuStars } from '../../amiga/view/menu-stars.ts';
import type { NativeGraphics, NativeRgb } from '../types/graphics.ts';
import type { NativeWorld } from '../types/world.ts';
import type { NativeEntity, NativeState } from '../types/index.ts';

export function blitAmigaShape(
    pixels: Uint8Array,
    frame: readonly number[],
    width: number,
    height: number,
    x: number,
    y: number,
    transparent = true,
) {
    x = Math.floor(x);
    y = Math.floor(y);
    for (let row = Math.max(0, -y); row < Math.min(height, 200 - y); row++)
        for (let col = Math.max(0, -x); col < Math.min(width, 320 - x); col++) {
            const ink = frame[row * width + col];
            if (!transparent || ink) pixels[(y + row) * 320 + x + col] = ink;
        }
}
export function amigaRgba(pixels: ArrayLike<number>, palette: readonly NativeRgb[]) {
    const rgba = new Uint8ClampedArray(64000 * 4);
    for (let i = 0; i < 64000; i++) {
        const rgb = palette[pixels[i]] || palette[0];
        rgba[i * 4] = rgb[0];
        rgba[i * 4 + 1] = rgb[1];
        rgba[i * 4 + 2] = rgb[2];
        rgba[i * 4 + 3] = 255;
    }
    return rgba;
}
function shape(
    pixels: Uint8Array,
    graphics: NativeGraphics,
    name: string,
    frame: number,
    x: number,
    y: number,
) {
    const resource = graphics.resources[name];
    if (!resource) return;
    blitAmigaShape(
        pixels,
        resource.frames[Math.abs(Math.floor(frame)) % resource.frames.length],
        resource.width,
        resource.height,
        x,
        y,
    );
}
function drawEntity(
    pixels: Uint8Array,
    graphics: NativeGraphics,
    entity: NativeEntity,
    state: NativeState,
) {
    const e = entity;
    if (!e.alive) return;
    if (e.kind === 'flyer')
        shape(
            pixels,
            graphics,
            graphics.stageFlyers[Math.floor(state.screenIndex / 25)][Math.max(0, e.type - 1) % 4],
            e.frame,
            e.x,
            e.y,
        );
    else if (e.kind === 'bullet') shape(pixels, graphics, 'bullets', e.dx < 0 ? 5 : 4, e.x, e.y);
    else if (e.kind === 'enemy-bullet') shape(pixels, graphics, 'bullets', e.type % 2, e.x, e.y);
    else if (e.kind === 'rocket-trail') shape(pixels, graphics, 'bullets', e.frame, e.x, e.y);
    else if (e.kind === 'grenade') shape(pixels, graphics, 'bullets', e.dx < 0 ? 3 : 2, e.x, e.y);
    else if (e.kind === 'pickup') shape(pixels, graphics, 'powerups', e.type, e.x, e.y);
    else if (e.kind === 'teleport' && state.teleportFrame >= 0 && state.teleportFrame < 13)
        // Native $d40c/$be54: effect is inset in the chamber, aligned to a16px word.
        shape(pixels, graphics, 'teleport', state.teleportFrame, (e.x - 16) & ~15, e.y + 16);
    else if (e.kind === 'pod-particle')
        shape(pixels, graphics, 'pod-particles', state.tick % 9, e.x, e.y);
    else if (e.kind === 'turret' && e.type < 2)
        shape(pixels, graphics, `turret-animation-${e.type}`, e.phase, e.x, e.y);
    else if (e.kind === 'laser' && e.type === 0)
        // Native $a854 aligns the upper sprite like the static base at $d362.
        shape(pixels, graphics, 'laser-animation', e.frame, e.x & ~15, e.y);
    else if (e.kind === 'laser' && e.type === 1) {
        for (let y = e.y; y < Math.min(184, e.y + e.height); y += 8)
            shape(pixels, graphics, 'energy-beam', state.tick % 7, e.x, y);
    } else if (e.kind === 'hunter')
        shape(
            pixels,
            graphics,
            e.type === 1 ? 'rocket' : 'missile',
            e.x < 150 ? (e.x < 110 ? 2 : 1) : 0,
            e.x,
            e.y,
        );
    else if (e.kind === 'debris') shape(pixels, graphics, 'debris', Math.min(e.type, 3), e.x, e.y);
    else if (e.kind === 'explosion')
        shape(
            pixels,
            graphics,
            e.type === 1 ? 'small-explosion' : 'large-explosion',
            e.frame,
            e.type === 1 ? e.x & ~15 : e.x,
            e.y,
        );
    else if (e.kind === 'spike' && e.frame > 0) {
        const resource = graphics.resources.spikes;
        blitAmigaShape(pixels, resource.frames[0], 32, e.frame + 1, e.x, 175 - e.frame, false);
    } else if (e.kind === 'mine' && state.tiles[e.phase] !== 0xa2)
        shape(pixels, graphics, 'mines', 1 + (state.tick % 2), e.x, e.y);
}
// Native $c29c: 100 attempts in320x176, cycling the source plane combinations.
// A reproducible seed replaces the original hardware-clock seed for presentation only.
export function drawAmigaStars(pixels: Uint8Array, seed: number) {
    const inks = [1, 3, 7, 2, 4, 8, 6, 14, 5, 9, 12, 10, 13, 13];
    let random = (seed + 1) * 7919;
    for (let i = 0; i < 100; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const x = random % 320;
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const y = random % 176;
        const offset = y * 320 + x;
        if (!pixels[offset]) pixels[offset] = inks[i % inks.length];
    }
}
export function composeAmigaScene(
    state: NativeState,
    graphics: NativeGraphics,
    world: NativeWorld,
    { stars = true, gameStar = createAmigaGameStar() } = {},
) {
    const pixels = new Uint8Array(64000),
        screen = world.screens[state.screenIndex];
    const tileset = graphics.tilesets[graphics.stageTileSets[screen.stage]];
    state.tiles.forEach((tile, at) =>
        blitAmigaShape(
            pixels,
            tileset[tile] || tileset[0],
            8,
            8,
            (at % 40) * 8,
            Math.floor(at / 40) * 8,
            false,
        ),
    );
    if (stars) drawAmigaStars(pixels, state.screenIndex);
    for (const item of screen.static) {
        const markers = [0xff, 0xf7, 0xf5, 0xf6, 0xfc, 0xf8];
        const row = Math.floor(item.y / 8),
            column = Math.floor(item.x / 8);
        const removed = [column, column + 1].some(
            (x) => markers.includes(screen.tiles[row * 40 + x]) && state.tiles[row * 40 + x] === 0,
        );
        if (removed) continue;
        const frame = graphics.resources[item.resource].frames[0];
        blitAmigaShape(pixels, frame, item.width, item.height, item.x, item.y, item.transparent);
    }
    for (const entity of state.entities)
        if (entity.kind !== 'debris' && entity.kind !== 'rocket-trail')
            drawEntity(pixels, graphics, entity, state);
    // $98dc traverses the reusable smoke pool in slot order after drawing the rocket.
    for (const puff of state.entities
        .filter((entity) => entity.kind === 'rocket-trail')
        .sort((a, b) => (a.path ?? 0) - (b.path ?? 0)))
        drawEntity(pixels, graphics, puff, state);
    if (state.screenIndex % 25 === 24)
        shape(pixels, graphics, 'exit-gate', state.tick % 2, 200, 104);
    const p = state.player;
    if (p.deathTick < 15)
        shape(
            pixels,
            graphics,
            'death',
            p.deathTick + (p.armored ? 15 : 0),
            p.deathX,
            p.deathY - 48,
        );
    else if (!(p.invulnerableTicks > 0 && state.tick & 1))
        shape(pixels, graphics, p.armored ? 'player-armored' : 'player', p.pose, p.x, p.y - 40);
    // Original $c824 redraws complete tile rectangles (including black) in front of sprites.
    state.tiles.forEach((tile, at) => {
        if (tile > 0 && tile <= 128)
            blitAmigaShape(
                pixels,
                tileset[tile],
                8,
                8,
                (at % 40) * 8,
                Math.floor(at / 40) * 8,
                false,
            );
    });
    // Original $bf3c draws debris after the foreground redraw at $c824.
    for (const entity of state.entities)
        if (entity.kind === 'debris') drawEntity(pixels, graphics, entity, state);
    if (stars) gameStar.draw(pixels, graphics, state.screenIndex, state.tick);
    const digits = (value: number, length: number, x: number) => {
        const text = String(Math.max(0, Math.floor(value)))
            .padStart(length, '0')
            .slice(-length);
        for (let col = 0; col < text.length; col++)
            for (let y = 0; y < 7; y++)
                for (let bit = 0; bit < 8; bit++) {
                    const target = (193 + y) * 320 + x + col * 8 + bit;
                    pixels[target] =
                        (pixels[target] & ~2) |
                        (((graphics.hudFont[Number(text[col])][y] >> (7 - bit)) & 1) * 2);
                }
    };
    digits(state.ammo, 2, 24);
    digits(state.grenades, 2, 88);
    digits(state.score, 6, 144);
    digits(state.lives, 1, 224);
    digits(state.screenIndex + 1, 3, 272);
    return pixels;
}
export function drawAmigaText(
    pixels: Uint8Array,
    graphics: NativeGraphics,
    text: string,
    x: number,
    y: number,
    ink = 2,
) {
    for (const [index, character] of [
        ...(graphics.asciiFont ? text : text.toUpperCase()),
    ].entries()) {
        const code = character.charCodeAt(0);
        const glyph =
            code >= 65 && code <= 90
                ? code - 65
                : code >= 48 && code <= 57
                  ? code - 48 + 27
                  : character === '.'
                    ? 26
                    : character === '*'
                      ? 37
                      : 38;
        const rows = graphics.asciiFont?.[code] || graphics.font[glyph] || [];
        for (let row = 0; row < 8; row++)
            for (let bit = 0; bit < 8; bit++) {
                const xx = x + index * 8 + bit,
                    yy = y + row;
                if (xx >= 0 && xx < 320 && yy >= 0 && yy < 200)
                    pixels[yy * 320 + xx] = (rows[row] >> (7 - bit)) & 1 ? ink : 0;
            }
    }
}
/** Native unmirrored 16px window tiles. Both releases share the edge blitter. */
function drawNativeWindow(
    pixels: Uint8Array,
    graphics: NativeGraphics,
    x: number,
    y: number,
    width: number,
    height: number,
    style: 0 | 3,
) {
    const tiles = graphics.resources['window-tiles'];
    for (let row = 0; row < height / 16; row++)
        for (let col = 0; col < width / 16; col++) {
            const vertical = col === 0 || col === width / 16 - 1;
            const horizontal = row === 0 || row === height / 16 - 1;
            if (!vertical && !horizontal) continue;
            const frame = style + (vertical ? (horizontal ? 0 : 1) : 2);
            blitAmigaShape(pixels, tiles.frames[frame], 16, 16, x + col * 16, y + row * 16, false);
        }
}
/** Original Amiga $88fe and Atari $884: opaque128x48 dialog over the stage. */
function drawAmigaGameOver(pixels: Uint8Array, graphics: NativeGraphics): void {
    drawNativeWindow(pixels, graphics, 96, 72, 128, 48, 3);
    for (const record of graphics.text.gameOver)
        drawAmigaText(pixels, graphics, record.text, record.x, record.y, record.ink ?? 2);
}

export interface NativePresentation {
    page?: 'title' | 'scores' | 'name';
    paused?: boolean;
    /** Explicit page epoch keeps menu animation timing independent of resource preparation. */
    startedAt?: number;
    rows?: readonly { name: string; score: number }[];
    name?: string;
}
export function createNativeRenderer(
    canvas: HTMLCanvasElement,
    graphics: NativeGraphics,
    world: NativeWorld,
    platform: 'amiga' | 'atari-st' = 'amiga',
) {
    canvas.width = 320;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.imageSmoothingEnabled = false;
    const image = context.createImageData(320, 200);
    let lastPage: NativePresentation['page'];
    const gameStar = createAmigaGameStar();
    let scoresStartedAt = 0;
    let titleStartedAt = 0;
    let menuStars = createAmigaMenuStars(graphics);
    return {
        render(state: NativeState, now = 0, presentation: NativePresentation = {}) {
            if (canvas.width !== 320 || canvas.height !== 200) {
                canvas.width = 320;
                canvas.height = 200;
                context.imageSmoothingEnabled = false;
            }
            let pixels: Uint8Array;
            const page = presentation.page;
            if (
                page === 'scores' &&
                (lastPage !== 'scores' ||
                    (presentation.startedAt !== undefined &&
                        scoresStartedAt !== presentation.startedAt))
            )
                scoresStartedAt = presentation.startedAt ?? now;
            if (
                page === 'title' &&
                (lastPage !== 'title' ||
                    (presentation.startedAt !== undefined &&
                        titleStartedAt !== presentation.startedAt))
            ) {
                titleStartedAt = presentation.startedAt ?? now;
                menuStars = createAmigaMenuStars(graphics);
            }
            lastPage = page;
            const stagePalette = graphics.stagePalettes[Math.floor(state.screenIndex / 25)];
            let palette = stagePalette;
            if (page) {
                pixels = new Uint8Array(64000);
                palette = graphics.palette;
                // Native Hall of Fame $8b68 usesY8; the title usesY18.
                if (platform === 'atari-st' && page === 'name')
                    drawNativeWindow(pixels, graphics, 0, 0, 320, 192, 0);
                shape(
                    pixels,
                    graphics,
                    'logo',
                    0,
                    80,
                    page === 'scores' ? 8 : platform === 'atari-st' && page === 'name' ? 24 : 18,
                );
                if (page === 'scores')
                    for (const x of [0, 256])
                        for (const y of [0, 64, 128])
                            shape(pixels, graphics, 'score-pipe', 0, x, y);
                if (page === 'title') {
                    for (const record of graphics.text.menu)
                        drawAmigaText(
                            pixels,
                            graphics,
                            record.text,
                            record.x,
                            record.y,
                            record.ink ?? 2,
                        );
                    menuStars.render(pixels, Math.floor((now - titleStartedAt) / 80));
                } else if (page === 'name') {
                    for (const record of graphics.text.nameEntry)
                        drawAmigaText(
                            pixels,
                            graphics,
                            record.text,
                            record.x,
                            record.y,
                            record.ink ?? 2,
                        );
                    drawAmigaText(
                        pixels,
                        graphics,
                        (presentation.name || '').padEnd(10, '.'),
                        120,
                        128,
                        platform === 'atari-st' ? 11 : 2,
                    );
                } else {
                    const rows = presentation.rows || graphics.highScores;
                    const offset =
                        Math.floor((now - scoresStartedAt) / (platform === 'atari-st' ? 40 : 80)) %
                        (rows.length * 8 + 146);
                    const text = new Uint8Array(64000);
                    rows.forEach((row, index) => {
                        const y = 200 + index * 8 - offset;
                        if (y < 192 && y + 8 > 54)
                            drawAmigaText(
                                text,
                                graphics,
                                `${row.name.padEnd(10, '.')} ${String(row.score).padStart(6, '0')}`,
                                96,
                                y,
                            );
                    });
                    // Native $8cbe/$8cc6 copies only X80..239,Y54..191.
                    // Clip individual scanlines so rows enter and leave gradually.
                    for (let y = 54; y < 192; y++) {
                        const start = y * 320 + 80;
                        pixels.set(text.subarray(start, start + 160), start);
                    }
                }
            } else {
                pixels = composeAmigaScene(state, graphics, world, { gameStar });
                if (state.status === 'over') {
                    drawAmigaGameOver(pixels, graphics);
                } else if (state.status === 'bonus' || state.status === 'won') {
                    const summary = state.status === 'bonus' && state.bonusPhase === 'summary';
                    const atari = platform === 'atari-st';
                    if (atari && summary) {
                        drawNativeWindow(pixels, graphics, 80, 72, 160, 80, 3);
                    } else {
                        pixels.fill(0);
                        palette = graphics.palette;
                        if (atari) drawNativeWindow(pixels, graphics, 0, 0, 320, 192, 0);
                        shape(pixels, graphics, 'logo', 0, 80, atari ? 24 : 18);
                    }
                    const records =
                        graphics.text[
                            state.status === 'bonus'
                                ? summary
                                    ? 'bravery'
                                    : state.bonusPhase === 'ending'
                                      ? 'ending'
                                      : 'bonus'
                                : 'ending'
                        ];
                    for (const record of records)
                        drawAmigaText(
                            pixels,
                            graphics,
                            record.text,
                            record.x,
                            record.y,
                            record.ink ?? 2,
                        );
                    if (state.status === 'bonus' && state.bonusPhase === 'roulette')
                        drawAmigaText(
                            pixels,
                            graphics,
                            '*',
                            208,
                            (atari ? 104 : 90) + (state.bonusTicks % 8) * 8,
                            atari ? 7 : 2,
                        );
                    if (summary) {
                        for (const record of graphics.text.lifeBonus)
                            drawAmigaText(
                                pixels,
                                graphics,
                                record.text,
                                record.x,
                                record.y,
                                record.ink ?? 2,
                            );
                        const amount = String(state.player.armored ? 0 : 10000).padStart(5, '0');
                        if (atari)
                            drawAmigaText(
                                pixels,
                                graphics,
                                amount.padStart(10, ' ').padEnd(16, ' '),
                                96,
                                96,
                                7,
                            );
                        else drawAmigaText(pixels, graphics, amount, 144, 96);
                        drawAmigaText(
                            pixels,
                            graphics,
                            String(state.lives),
                            128,
                            112,
                            atari ? 7 : 2,
                        );
                    }
                }
                if (presentation.paused) drawAmigaText(pixels, graphics, 'PAUSED', 136, 86);
            }
            image.data.set(amigaRgba(pixels, palette));
            context.putImageData(image, 0, 0);
        },
    };
}
