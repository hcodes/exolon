import type { GraphicTile } from '../types/graphics.ts';
import type { GameState, GameScreen, GameEvent } from '../types/game.ts';
import type {
    Graphics,
    NativeGraphics,
    CpcGraphics,
    SharpGraphics,
    SpectrumScreen,
    SceneRenderer,
    Particle,
    Emitter,
    Piece,
    Raster,
    RenderOptions,
    TitleOptions,
    RenderArgs,
    TitleArgs,
} from '../types/graphics.ts';
// Source graphics: Raffaele Cecco / Hewson; disassembly Sergey Erokhin, CC BY-SA 3.0.
import { drawControlMenu } from './control-menu.ts';
import { isTvBrowser } from '../utils/tv.ts';
import { createRemasteredRenderer } from './remastered-renderer.ts';
import { createC64Renderer } from './c64-renderer.ts';
import { createCpcRenderer } from './cpc-renderer.ts';
import { createSharpDisplay } from './sharp-renderer.ts';
import { createGameBoyRenderer } from './gameboy-renderer.ts';
import { createGameBoyColorRenderer } from './gameboy-color-renderer.ts';
import { drawTitleStars, findTitleStarPositions, createTitleBackground } from './title-stars.ts';
import {
    createScreen,
    copyScreen,
    putTile,
    freezeBackground,
    xorSprite,
    paintAttribute,
    putText,
    fromScr,
    toRgba,
} from './spectrum.ts';

const PARTICLE = [3, 4, 5, 3, 5, 4, 5, 5, 5, 6];
const DISSOLVE = [5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 0];
const DELTA = [-4, -3, -2, 0, 0, 2, 3, 4];
const hash = (value: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
};

function cells(screen: SpectrumScreen, data: GraphicTile[]) {
    for (const tile of data) putTile(screen, tile);
}
export function createStaticScene(state: GameState, graphics: Graphics) {
    const screen = createScreen();
    const initialAttributes = new Uint8Array(704);
    state.screen.tiles.forEach((tile, index) => {
        if (tile && index < 704) initialAttributes[index] = tile.color || 0;
    });
    const inactive = new Set(
        (state.objects || []).filter((object) => !object.active).map((object) => object.instance),
    );
    state.screen.tiles.forEach((tile, offset) => {
        if (
            !tile ||
            offset >= 704 ||
            state.destroyed.includes(tile.instance!) ||
            ([18, 19, 20].includes(tile.block) && inactive.has(tile.instance!))
        )
            return;
        putTile(screen, {
            ...tile,
            x: offset % 32,
            y: offset >> 5,
            bitmap: graphics.shapes[tile.shape || 0],
        });
    });
    cells(screen, graphics.screens.hud);
    freezeBackground(screen);
    // Original init_random_stars: three attempts per row, tested against saved scenery attributes.
    let random = hash((state.screenIndex || 0) + 1);
    for (let y = 21; y >= 0; y--)
        for (let attempt = 0; attempt < 3; attempt++) {
            random = hash(random + 1);
            const x = random & 31;
            if (initialAttributes[y * 32 + x]) continue;
            random = hash(random + 1);
            putTile(screen, { x, y, bitmap: graphics.star, color: (random & 7) | 0x42 });
        }
    return screen;
}

export function createRenderer(canvas: HTMLCanvasElement, graphics: Graphics) {
    const output = canvas.getContext('2d', { alpha: false })!;
    if (
        !output ||
        graphics?.version !== 1 ||
        graphics.player.length !== 2400 ||
        graphics.loading.length !== 6912 ||
        graphics.turret?.length !== 128
    ) {
        throw new Error('Could not prepare the original Exolon graphics.');
    }
    const retroCanvas = canvas.ownerDocument.createElement('canvas');
    const modernCanvas = canvas.ownerDocument.createElement('canvas');
    const c64Canvas = canvas.ownerDocument.createElement('canvas');
    const cpcCanvas = canvas.ownerDocument.createElement('canvas');
    const gameboyCanvas = canvas.ownerDocument.createElement('canvas');
    const gameboy = createGameBoyRenderer(gameboyCanvas);
    const gameboyColorCanvas = canvas.ownerDocument.createElement('canvas');
    const gameboyColor = createGameBoyColorRenderer(gameboyColorCanvas);
    const context = retroCanvas.getContext('2d')!;
    canvas.width = retroCanvas.width = 256;
    canvas.height = retroCanvas.height = 192;
    context.imageSmoothingEnabled = false;
    const image = context.createImageData(256, 192);
    const retroRaster: Raster = { context, image };
    const handheldSource = canvas.ownerDocument.createElement('canvas');
    handheldSource.width = 256;
    handheldSource.height = 192;
    const handheldContext = handheldSource.getContext('2d')!;
    const handheldRaster: Raster = {
        context: handheldContext,
        image: handheldContext.createImageData(256, 192),
    };

    const remasteredScale = isTvBrowser(canvas.ownerDocument.defaultView?.navigator.userAgent || '')
        ? 2
        : 4;
    const remastered = createRemasteredRenderer(modernCanvas, graphics, remasteredScale);
    const loading = createTitleBackground(fromScr(graphics.loading), graphics.screens.logo);
    let c64: SceneRenderer | null = null;
    function setC64Graphics(data?: NativeGraphics) {
        if (data?.version !== 1 || data.blocks?.length !== 62 || data.player?.length !== 2400)
            return false;
        c64?.reset();
        c64 = createC64Renderer(c64Canvas, data, loading);
        return true;
    }
    setC64Graphics(graphics.c64);
    let cpc: SceneRenderer | null = null;
    function setCpcGraphics(data?: CpcGraphics) {
        if (
            data?.version !== 1 ||
            data.blocks?.length !== 62 ||
            data.player?.length !== 4800 ||
            data.palette?.length !== 16 ||
            data.loading?.length !== 16384
        )
            return false;
        cpc?.reset();
        cpc = createCpcRenderer(cpcCanvas, data, loading);
        return true;
    }
    setCpcGraphics(graphics.cpc);
    const sharpSource = canvas.ownerDocument.createElement('canvas');
    sharpSource.width = 256;
    sharpSource.height = 192;
    const sharpContext = sharpSource.getContext('2d')!;
    const sharpRaster: Raster = {
        context: sharpContext,
        image: sharpContext.createImageData(256, 192),
        nativePixels: true,
    };
    const sharpCanvas = canvas.ownerDocument.createElement('canvas');
    const sharpDisplay = createSharpDisplay(sharpCanvas);
    let sharpGraphics: Graphics | undefined;
    function setSharpGraphics(data?: SharpGraphics) {
        if (
            data?.version !== 1 ||
            data.width !== 320 ||
            data.height !== 200 ||
            data.player?.length !== 2400 ||
            data.shapes?.length !== 483 ||
            !data.screens?.menu?.length
        )
            return false;
        sharpGraphics = { ...graphics, ...data, loading: graphics.loading };
        sharpRaster.graphics = sharpGraphics;
        return true;
    }
    setSharpGraphics(graphics.sharp);
    let graphicsMode = 'retro';
    let splitPosition = 0.5;
    let splitModes = { left: 'retro', right: 'remastered' };
    const visualModes = () => [
        'retro',
        'remastered',
        'gameboy',
        'gameboy-color',
        ...(c64 ? ['c64'] : []),
        ...(cpc ? ['cpc'] : []),
        ...(sharpGraphics ? ['sharp-mz800'] : []),
    ];
    const titleStarPositions = findTitleStarPositions(loading);
    const menuBase = createScreen();
    cells(menuBase, graphics.screens.menu);
    freezeBackground(menuBase);
    const menuStarPositions = findTitleStarPositions(menuBase);
    const scoreBase = createScreen();
    scoreBase.attributes.fill(0x44);
    cells(scoreBase, graphics.screens.scores);
    // The source number-column attributes stop at row 22; scrolling also uses row 23.
    scoreBase.attributes.copyWithin(23 * 32 + 16, 22 * 32 + 16, 22 * 32 + 24);
    freezeBackground(scoreBase);
    // Reserve the full scrolling name/score strip, including temporarily empty rows.
    const scoreStarPositions = findTitleStarPositions(scoreBase).filter(
        ({ x, y }) => x + 16 <= 64 || x >= 192 || y + 16 <= 32,
    );
    const bonusBase = createScreen();
    cells(bonusBase, graphics.screens.bonus);
    freezeBackground(bonusBase);
    let cached: SpectrumScreen | null = null,
        cachedScreen: GameScreen | null = null,
        cachedKey = '',
        cachedGraphics: Graphics | null = null,
        effects: Particle[] = [],
        emitters: Emitter[] = [],
        pieces: Piece[] = [];
    let previousTick = -1,
        previousScreen = -1;

    function present(screen: SpectrumScreen, time: number, raster: Raster = retroRaster) {
        if (raster === sharpRaster) {
            sharpDisplay.render(screen, time);
            return;
        }
        toRgba(screen, Boolean(Math.floor(time / 320) & 1), raster.image.data);
        raster.context.imageSmoothingEnabled = false;
        raster.context.putImageData(raster.image, 0, 0);
    }
    function renderLayer(
        mode: string,
        method: 'render' | 'renderTitle',
        args: RenderArgs | TitleArgs,
    ) {
        if (mode === 'retro') {
            if (method === 'renderTitle') renderRetroTitle(...(args as TitleArgs));
            else renderRetro(...(args as RenderArgs));
            return retroCanvas;
        }
        if (mode === 'remastered') {
            if (method === 'renderTitle') remastered.renderTitle(...(args as TitleArgs));
            else remastered.render(...(args as RenderArgs));
            return modernCanvas;
        }
        if (mode === 'c64') {
            if (method === 'renderTitle') c64!.renderTitle(...(args as TitleArgs));
            else c64!.render(...(args as RenderArgs));
            return c64Canvas;
        }
        if (mode === 'cpc') {
            if (method === 'renderTitle') cpc!.renderTitle(...(args as TitleArgs));
            else cpc!.render(...(args as RenderArgs));
            return cpcCanvas;
        }
        if (mode === 'sharp-mz800') {
            if (method === 'renderTitle') renderSharpTitle(...(args as TitleArgs));
            else {
                const [state, time, fraction, options] = args as RenderArgs;
                renderRetro(state, time, fraction, options, sharpRaster);
            }
            return sharpCanvas;
        }
        const color = mode === 'gameboy-color';
        if (method === 'renderTitle')
            renderRetroTitle((args as TitleArgs)[0], (args as TitleArgs)[1], handheldRaster);
        else
            renderRetro(
                (args as RenderArgs)[0],
                ((args as RenderArgs)[0].tick * 1000) / 30,
                0,
                (args as RenderArgs)[3],
                color ? { ...handheldRaster, independentSprites: true } : handheldRaster,
            );
        (color ? gameboyColor : gameboy).render(handheldSource);
        return color ? gameboyColorCanvas : gameboyCanvas;
    }
    function composite(method: 'render' | 'renderTitle', args: RenderArgs | TitleArgs) {
        const split = graphicsMode === 'split',
            width =
                split || graphicsMode === 'remastered'
                    ? 256 * remasteredScale
                    : graphicsMode === 'sharp-mz800'
                      ? 320
                      : 256,
            height = graphicsMode === 'sharp-mz800' ? 200 : (width * 3) / 4;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        output.imageSmoothingEnabled = false;
        output.clearRect(0, 0, width, height);
        const right = split ? splitModes.right : graphicsMode;
        output.drawImage(renderLayer(right, method, args), 0, 0, width, height);
        if (split && splitPosition > 0 && splitModes.left !== right) {
            // Composite independent snapshots: handheld layers have their own
            // ZX raster buffer and logical FLASH time, including in WebKit.
            const left = renderLayer(splitModes.left, method, args);
            output.save();
            output.beginPath();
            output.rect(0, 0, Math.round(width * splitPosition), height);
            output.clip();
            output.drawImage(left, 0, 0, width, height);
            output.restore();
        }
    }
    function small(screen: SpectrumScreen, id: number, x: number, y: number, color = 0x47) {
        xorSprite(screen, graphics.small.slice(id * 32, id * 32 + 32), 16, 16, x, y, color);
    }
    function shifted(screen: SpectrumScreen, id: number, x: number, y: number, color = 0x47) {
        const phase = (Math.floor(x / 2) & 3) * 16,
            start = id * 64 + phase;
        xorSprite(
            screen,
            graphics.shifted.slice(start, start + 16),
            16,
            8,
            Math.floor(x / 8) * 8,
            y,
            screen.nativePixels ? 0x07 : screen.spriteColors ? color : null,
            { foreground: false },
        );
        paintAttribute(screen, x, y, 8, 8, color);
    }
    function piece(x: number, y: number, tick: number, seed: number, color: number) {
        if (pieces.length >= 100) return;
        let random = hash(seed),
            dy = DELTA[(random >> 3) & 7] * 2;
        const dx = DELTA[random & 7] * 2;
        // The source retries only dy when both deltas are zero.
        while (!dx && !dy) {
            random = hash(random + 1);
            dy = DELTA[random & 7] * 2;
        }
        pieces.push({ x, y, dx, dy, color: color & 0x47, tick });
    }
    function particle(x: number, y: number, tick: number, seed: number, large = false) {
        const list = effects.filter(
            (effect) => Boolean(effect.large) === large && tick - effect.tick < (large ? 11 : 10),
        );
        if (list.length >= (large ? 10 : 20)) return;
        const color = large ? 0x42 + (hash(seed) & 3) : (hash(seed) & 7) | 0x42;
        effects.push({ x, y, tick, large, color });
    }
    function animate(screen: SpectrumScreen, state: GameState, source: Graphics = graphics) {
        for (const object of state.objects || []) {
            if (!object.active) {
                if (object.type === 5) {
                    const frame = (state.tick & 1) * 16,
                        color = (hash(state.tick * 7919 + object.id + 1) & 7) | 0x42;
                    for (let column = 0; column < 2; column++)
                        putTile(screen, {
                            x: object.x + column,
                            y: object.y,
                            bitmap: source.mine.slice(frame + column * 8, frame + column * 8 + 8),
                            color,
                        });
                }
                continue;
            }
            const x = object.x * 8,
                y = object.y * 8,
                random = hash(state.tick * 7919 + object.id + 1);
            if (object.type === 2) {
                const frame = state.tick % 3,
                    color = (random & 7) | 0x42;
                for (let row = 0; row < 2; row++)
                    putTile(screen, {
                        x: object.x,
                        y: object.y + 1 + row,
                        bitmap: source.torch.slice(frame * 16 + row * 8, frame * 16 + row * 8 + 8),
                        color,
                    });
            } else if (object.type === 3) {
                const frame = [0, 1, 2, 3, 4, 5, 6, 7, 0][object.phase - 1] ?? 0;
                for (let column = 0; column < 2; column++)
                    putTile(screen, {
                        x: object.x + column,
                        y: object.y,
                        bitmap: source.turret.slice(
                            frame * 16 + column * 8,
                            frame * 16 + column * 8 + 8,
                        ),
                        color: column ? 6 : 70,
                    });
            } else if (object.type === 4)
                screen.attributes[object.y * 32 + object.x] = (state.tick & 7) | 0x40;
            else if (object.type === 10)
                xorSprite(
                    screen,
                    source.player.slice(24 * 96, 25 * 96),
                    24,
                    32,
                    x,
                    (object.y + object.yOffset) * 8,
                    screen.nativePixels ? 0x47 : 0x44,
                );
            else if (object.type === 15) {
                const frame = 28 + (random & 3),
                    color = screen.nativePixels ? 0x47 : ((random >> 8) & 7) | 0x40;
                small(screen, frame, x, y, color);
                small(screen, frame + 1, x + 16, y, color);
            } else if (object.type === 17) {
                for (let row = 1; row <= object.length; row++)
                    putTile(screen, {
                        x: object.x,
                        y: object.y + row,
                        bitmap: source.beam,
                        color: (state.tick & 7) | 0x40,
                    });
            }
        }
    }
    function bullets(screen: SpectrumScreen, state: GameState) {
        for (const bullet of state.bullets) {
            xorSprite(screen, [0xbd], 8, 1, bullet.x * 2, bullet.y, null, { foreground: false });
            const offset = (bullet.y >> 3) * 32 + (bullet.x >> 2);
            if (
                !screen.spriteColors &&
                !screen.nativePixels &&
                offset >= 0 &&
                offset + 1 < 704 &&
                !screen.background[offset] &&
                !screen.background[offset + 1]
            ) {
                screen.attributes[offset] = screen.attributes[offset + 1] = 0x47;
            }
        }
        for (const bullet of state.enemyBullets) {
            xorSprite(
                screen,
                [0xc0, 0xc0],
                8,
                2,
                bullet.x * 2,
                bullet.y,
                screen.nativePixels ? 0x46 : null,
                {
                    foreground: false,
                },
            );
            paintAttribute(screen, bullet.x * 2, bullet.y, 2, 2, 0x47);
        }
        if (state.grenade)
            shifted(screen, state.grenade.dx < 0 ? 1 : 0, state.grenade.x * 2, state.grenade.y);
        for (const rocket of state.rockets) {
            if (rocket.kind === 'homing')
                small(screen, rocket.x < 70 ? 11 : 10, rocket.x * 2, rocket.y);
            else shifted(screen, 8, rocket.x * 2, rocket.y);
        }
        for (const sphere of state.spheres) shifted(screen, 7, sphere.x * 2, sphere.y, 0x42);
        for (const enemy of state.enemies)
            small(
                screen,
                enemy.sprite + ((enemy.phase + 3) & 3),
                enemy.x * 2,
                enemy.y,
                enemy.color,
            );
        if (state.killer) small(screen, 36, state.killer.x * 2, state.killer.y);
    }
    function paintEffects(screen: SpectrumScreen, state: GameState) {
        for (const effect of effects) {
            const age = state.tick - effect.tick;
            if (age < 0) continue;
            const sequence = effect.large ? DISSOLVE : PARTICLE;
            if (age >= sequence.length) continue;
            if (effect.large)
                small(
                    screen,
                    sequence[age],
                    effect.x,
                    effect.y,
                    screen.nativePixels ? 0x47 : effect.color,
                );
            else shifted(screen, sequence[age], effect.x, effect.y, effect.color);
        }
        for (const piece of pieces) {
            const age = state.tick - piece.tick,
                x = piece.x + age * piece.dx,
                y = piece.y + age * piece.dy;
            if (age >= 0 && x >= 0 && x < 240 && y >= 0 && y < 169)
                shifted(screen, 2, x, y, piece.color);
        }
    }
    function hud(screen: SpectrumScreen, state: GameState, source: Graphics = graphics) {
        const text = (value: number, length: number) =>
            String(value).padStart(length, '0').slice(-length);
        putText(screen, source.font, text(state.ammo, 2), 1, 23, 0x47);
        putText(screen, source.font, text(state.grenades, 2), 8, 23, 0x43);
        putText(screen, source.font, text(state.score, 6), 14, 23, 0x45);
        putText(screen, source.font, text(state.lives, 1), 23, 23, 0x46);
        putText(screen, source.font, text(state.screenIndex + 1, 3), 28, 23, 0x46);
    }
    function addEvents(events: GameEvent[], state: GameState) {
        if (!state) return;
        remastered.observe(state, events);
        c64?.observe(state, events);
        cpc?.observe(state, events);
        if (
            state.tick < previousTick ||
            state.screenIndex !== previousScreen ||
            events.some((event) =>
                ['respawn', 'screen', 'screen-change', 'stage'].includes(event.type),
            )
        ) {
            effects = [];
            emitters = [];
            pieces = [];
        }
        if (state.tick === previousTick && state.screenIndex === previousScreen) return;
        previousTick = state.tick;
        previousScreen = state.screenIndex;
        effects = effects.filter((effect) => state.tick - effect.tick < (effect.large ? 11 : 10));
        for (const event of events) {
            const seed = hash(
                state.tick * 127 + Math.trunc(event.x || 0) * 31 + Math.trunc(event.y || 0) + 1,
            );
            if (event.type === 'object-destroyed') {
                state.screen.tiles.forEach((tile, index) => {
                    if (!tile || tile.instance !== event.instance || index >= 704) return;
                    for (let part = 0; part < 2; part++)
                        piece(
                            (index % 32) * 8,
                            (index >> 5) * 8,
                            state.tick,
                            seed + index * 2 + part + 1,
                            tile.color || 0,
                        );
                });
            } else if (event.type === 'teleport' || event.type === 'teleport-arrive') {
                emitters.push({ x: event.x, y: event.y - 12, tick: state.tick, seed });
            } else if (event.type === 'mine') {
                const below = (event.y / 8 + 1) * 32 + event.x / 8;
                const color = state.screen.tiles[below]?.color || 0;
                for (let round = 0; round < 5; round++)
                    for (let column = 0; column < 2; column++)
                        for (let part = 0; part < 2; part++)
                            piece(
                                event.x + column * 8,
                                event.y - 8,
                                state.tick,
                                seed + round * 4 + column * 2 + part + 1,
                                color,
                            );
            } else if (['enemy-destroyed', 'explosion'].includes(event.type)) {
                const large =
                    event.type === 'enemy-destroyed' && [150, 850].includes(event.points!);
                particle(event.x, event.y, state.tick, seed, large);
            }
        }
        emitters = emitters.filter((emitter) => state.tick - emitter.tick < 20);
        for (const emitter of emitters) {
            const random = hash(emitter.seed + state.tick * 17);
            particle(
                emitter.x + (random & 3) * 2,
                emitter.y + ((random >> 4) & 15),
                state.tick,
                random,
            );
        }
        if (state.grenade && state.grenade.phase >= 19)
            particle(
                state.grenade.x * 2 - state.grenade.dx * 8,
                state.grenade.y,
                state.tick,
                state.tick + 7,
            );
        if (state.killer)
            particle(state.killer.x * 2 + 8, state.killer.y + 8, state.tick, state.tick + 19);
        pieces = pieces.filter((piece) => {
            const age = state.tick - piece.tick,
                x = piece.x + age * piece.dx,
                y = piece.y + age * piece.dy;
            return age < 176 && x >= 0 && x < 240 && y >= 0 && y < 169;
        });
    }
    function renderRetro(
        state: GameState,
        time = 0,
        _fraction = 0,
        { paused = false, nameEntry = false, playerName = null }: RenderOptions = {},
        raster: Raster = retroRaster,
    ) {
        const source = raster.graphics || graphics;
        if (state.status === 'won' || nameEntry) {
            const screen = createScreen();
            cells(screen, source.screens.hallOfFame);
            if (playerName !== null)
                putText(screen, source.font, playerName.padEnd(8, '-').slice(0, 8), 12, 15, 0x47);
            present(screen, time, raster);
            return;
        }
        if (state.status === 'bonus') {
            const screen = source === graphics ? copyScreen(bonusBase) : createScreen();
            if (source !== graphics) cells(screen, source.screens.bonus);
            putText(screen, source.font, '*', 22, 13 + (state.bonus!.cursor & 7), 0x47);
            present(screen, time, raster);
            return;
        }
        const key = `${state.destroyed.join(',')}:${(state.objects || [])
            .filter((object) => !object.active)
            .map((object) => object.id)
            .join(',')}`;
        if (
            !cached ||
            cachedScreen !== state.screen ||
            cachedKey !== key ||
            cachedGraphics !== source
        ) {
            cached = createStaticScene(state, source);
            cachedScreen = state.screen;
            cachedKey = key;
            cachedGraphics = source;
        }
        const screen = copyScreen(cached, {
            independentSprites: Boolean(raster.independentSprites),
            nativePixels: Boolean(raster.nativePixels),
        });
        animate(screen, state, source);
        const player = state.player;
        const frame =
            (state.death || state.status === 'over'
                ? 11
                : (player.sprite ?? (player.duck ? 10 : 5))) + (state.exoskeleton ? 12 : 0);
        if (!state.invulnerable || !(state.tick & 2))
            xorSprite(
                screen,
                source.player.slice(frame * 96, frame * 96 + 96),
                24,
                32,
                player.x * 2,
                player.y,
                0x47,
                { mirror: player.direction < 0 },
            );
        bullets(screen, state);
        paintEffects(screen, state);
        hud(screen, state, source);
        if (state.status === 'over') {
            for (const tile of source.screens.gameOver)
                // The green display merges ZX red paper and yellow ink into light shades.
                // Keep the source glyphs on black paper before the Game Boy palette pass.
                putTile(screen, raster === handheldRaster ? { ...tile, color: 0x47 } : tile);
        } else if (paused) putText(screen, source.font, 'PAUSED', 13, 10, 0x47);
        present(screen, time, raster);
    }
    function renderRetroTitle(
        time = 0,
        { scores = false, menu = false, rows = [], offset = 0, controls }: TitleOptions = {},
        raster: Raster = retroRaster,
    ) {
        if (menu && !scores) {
            const screen = copyScreen(menuBase);
            drawTitleStars(screen, time, menuStarPositions, graphics.small);
            drawControlMenu('retro', controls, {
                clear() {
                    screen.bits.fill(0, 48 * 256, 168 * 256);
                    screen.attributes.fill(0, 6 * 32, 21 * 32);
                },
                text: (value, x, row) => putText(screen, graphics.font, value, x, row, 0x47),
                highlight(row, width) {
                    screen.attributes.fill(0x47, row * 32 + 11, row * 32 + 11 + width);
                },
            });
            present(screen, time, raster);
            return;
        }
        if (!scores) {
            const screen = copyScreen(loading);
            drawTitleStars(screen, time, titleStarPositions, graphics.small);
            present(screen, time, raster);
            return;
        }
        const screen = copyScreen(scoreBase);
        rows.forEach((row, index) =>
            putText(
                screen,
                graphics.font,
                `${row.name.padEnd(8, ' ')}  ${String(row.score).padStart(6, '0')}`,
                8,
                4 + index * 2,
                0x44,
                {
                    offsetY: -Math.floor(offset * 16),
                    clipTop: 32,
                    clipBottom: 192,
                    keepAttributes: true,
                },
            ),
        );
        drawTitleStars(screen, time, scoreStarPositions, graphics.small);
        present(screen, time, raster);
    }
    function renderSharpTitle(
        time = 0,
        { scores = false, rows = [], offset = 0, controls }: TitleOptions = {},
    ) {
        if (!sharpGraphics) return;
        const screen = createScreen();
        cells(screen, scores ? sharpGraphics.screens.scores : sharpGraphics.screens.menu);
        if (scores) {
            screen.attributes.copyWithin(23 * 32 + 16, 22 * 32 + 16, 22 * 32 + 24);
            rows.forEach((row, index) =>
                putText(
                    screen,
                    sharpGraphics!.font,
                    `${row.name.padEnd(8, ' ')}  ${String(row.score).padStart(6, '0')}`,
                    8,
                    4 + index * 2,
                    0x44,
                    {
                        offsetY: -Math.floor(offset * 16),
                        clipTop: 32,
                        clipBottom: 192,
                        keepAttributes: true,
                    },
                ),
            );
        }
        const positions = findTitleStarPositions(screen).filter(
            ({ x, y }) => !scores || x + 16 <= 64 || x >= 192 || y + 16 <= 32,
        );
        drawTitleStars(screen, time, positions, sharpGraphics.small);
        if (!scores)
            drawControlMenu('sharp-mz800', controls, {
                clear() {
                    screen.bits.fill(0, 48 * 256, 168 * 256);
                    screen.attributes.fill(0, 6 * 32, 21 * 32);
                },
                text: (value, x, row) => putText(screen, sharpGraphics!.font, value, x, row, 0x47),
                highlight(row, width) {
                    screen.attributes.fill(0x47, row * 32 + 11, row * 32 + 11 + width);
                },
            });
        present(screen, time, sharpRaster);
    }
    return {
        setC64Graphics,
        setCpcGraphics,
        setSharpGraphics,
        setGraphicsMode(mode: string) {
            graphicsMode = [
                'retro',
                'remastered',
                'split',
                'gameboy',
                'gameboy-color',
                ...(c64 ? ['c64'] : []),
                ...(cpc ? ['cpc'] : []),
                ...(sharpGraphics ? ['sharp-mz800'] : []),
            ].includes(mode)
                ? mode
                : 'retro';
            canvas.dataset.graphics = graphicsMode;
        },
        get graphicsMode() {
            return graphicsMode;
        },
        get graphicsModes() {
            return [
                'retro',
                'remastered',
                'split',
                'gameboy',
                'gameboy-color',
                ...(c64 ? ['c64'] : []),
                ...(cpc ? ['cpc'] : []),
                ...(sharpGraphics ? ['sharp-mz800'] : []),
            ];
        },
        setSplitModes(left: string, right: string) {
            const available = visualModes();
            splitModes = {
                left: available.includes(left) ? left : 'retro',
                right: available.includes(right) ? right : 'remastered',
            };
            return { ...splitModes };
        },
        get splitModes() {
            return { ...splitModes };
        },
        setSplitPosition(value: number) {
            if (Number.isFinite(value)) splitPosition = Math.max(0, Math.min(1, value));
        },
        get splitPosition() {
            return splitPosition;
        },
        addEvents,
        render(...args: RenderArgs) {
            composite('render', args);
        },
        renderTitle(...args: TitleArgs) {
            composite('renderTitle', args);
        },
        destroy() {
            remastered.reset();
            c64?.reset();
            cpc?.reset();
            sharpDisplay.reset();
            gameboy.reset();
            gameboyColor.reset();
            cached = null;
            cachedScreen = null;
            cachedGraphics = null;
            cachedKey = '';
            effects = [];
            emitters = [];
            pieces = [];
            previousTick = -1;
            previousScreen = -1;
        },
    };
}
