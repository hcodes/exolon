import type { GameEvent, GameState, StageBonus } from './game.ts';

export type Bytes = number[] | Uint8Array;
export type Rgba = Uint8ClampedArray<ArrayBufferLike>;
export type Point = { x: number; y: number };
export type Rectangle = Point & { w: number; h: number };
export interface GraphicTile extends Point {
    bitmap: Bytes;
    color?: number;
    ramColor?: number;
    overlay?: number;
}
export interface SpectrumScreen {
    bits: Uint8Array;
    attributes: Uint8Array;
    background: Uint8Array;
    allowed: Uint8Array;
    spriteColors?: Int16Array;
    // Full per-pixel palette indices for native planar graphics, independent of ZX cells.
    nativePixels?: Uint8Array;
}
export interface NativeSurface {
    pixels: Uint8Array;
    allowed: Uint8Array;
}
export interface NativeGraphicsScreens {
    hud: GraphicTile[];
    logo: GraphicTile[];
    menu: GraphicTile[];
    scores: GraphicTile[];
    gameOver: GraphicTile[];
}
export interface GraphicsScreens extends NativeGraphicsScreens {
    bonus: GraphicTile[];
    hallOfFame: GraphicTile[];
}
export interface BaseGraphics {
    version: number;
    player: Bytes;
    turret: Bytes;
    small: Bytes;
    shifted: Bytes;
    mine: Bytes;
    torch: Bytes;
    beam: Bytes;
    font: Bytes;
    screens: NativeGraphicsScreens;
}
export interface NativeGraphics extends BaseGraphics {
    blocks: { tiles: GraphicTile[] }[];
}
export interface CpcGraphics extends NativeGraphics {
    loading: Bytes;
    star: Bytes;
    compatibilityBlocks: { tiles: GraphicTile[] }[];
    palette: number[][];
    proceduralPixels: {
        star: { row: number; byte: number; randomMask: number };
        bullet: { odd: Bytes; even: Bytes };
        enemyBullet: { odd: Bytes; even: Bytes };
    };
    menuUnsupportedRows: number[];
}
export interface SharpGraphics extends BaseGraphics {
    width: number;
    height: number;
    shapes: Bytes[];
    star: Bytes;
    screens: GraphicsScreens;
    sourceRamSha256: string;
    sourceMZFSha256: string;
}
export interface Graphics extends BaseGraphics {
    loading: Bytes;
    star: Bytes;
    screens: GraphicsScreens;
    shapes: Bytes[];
    c64?: NativeGraphics;
    cpc?: CpcGraphics;
    sharp?: SharpGraphics;
}
export interface RenderOptions {
    paused?: boolean;
    nameEntry?: boolean;
    playerName?: string | null;
}
export interface ScoreRow {
    name: string;
    score: number;
}
export interface TitleOptions {
    controls?: import('../model/control-menu.ts').ControlMenuSnapshot;
    scores?: boolean;
    menu?: boolean;
    rows?: ScoreRow[];
    offset?: number;
}
export interface MenuOptions extends TitleOptions {
    kind?: 'title' | 'menu' | 'scores' | 'hallOfFame' | 'bonus' | 'gameOver';
    playerName?: string;
    state?: GameState;
    bonus?: Partial<StageBonus>;
    bestScore?: number;
}
export interface SceneRenderer {
    observe(state: GameState, events: GameEvent[]): void;
    render(state: GameState, time?: number, fraction?: number, options?: RenderOptions): void;
    renderTitle(time?: number, options?: TitleOptions): void;
    reset(): void;
}
export interface Raster {
    context: CanvasRenderingContext2D;
    image: ImageData;
    independentSprites?: boolean;
    nativePixels?: boolean;
    graphics?: Graphics;
}
export interface Particle extends Point {
    tick: number;
    color: number;
    large?: boolean;
}
export interface Piece extends Particle {
    dx: number;
    dy: number;
}
export interface Emitter extends Point {
    tick: number;
    seed: number;
}
export interface Appearance {
    tick: number;
    screen: number;
    direction: number;
    armored: boolean;
}
export interface Departure extends Point {
    direction: number;
    armored: boolean;
}
export interface MotionSnapshot extends Point {
    tick: number;
    screen: number;
}
export interface HeroFrame extends Point {
    fromX: number;
    fromY: number;
    fromPhase: number;
    phase: number;
    walking: boolean;
}
export interface SpriteEffect extends Point {
    type: string;
    tick: number;
    seed: number;
    life: number;
}
export interface SpriteDebris extends Particle {
    bitmap?: Bytes;
    half: number;
    vx: number;
    vy: number;
    spin: number;
}
export interface FragmentTile extends Point {
    shape: number;
    color: number;
    ink?: boolean;
}
export interface SceneItem extends Rectangle {
    index: number;
    tiles: FragmentTile[];
}
export type Contours = number[][][][];
export interface Fragment extends Point {
    tile: FragmentTile;
    clip: Rectangle;
    surface: Rectangle;
    tick: number;
    vx: number;
    vy: number;
    spin: number;
    life: number;
}
export type Palette = ReturnType<typeof import('../view/palette.ts').spectrumPalette>;
export type HeroPose = ReturnType<typeof import('../view/hero-motion.ts').getHeroPose>;
export type RenderArgs = [
    state: GameState,
    time?: number,
    fraction?: number,
    options?: RenderOptions,
];
export type TitleArgs = [time?: number, options?: TitleOptions];

export interface MotionProjectile extends Point {
    dx?: number;
    phase?: number;
    kind?: string;
    instance?: number;
    projectileId?: number;
}
export interface ProjectileSegment {
    from: Point;
    to: Point;
    start: Point;
    end: Point;
    measured: boolean;
    moving: boolean;
    phase?: number;
    direction?: number;
    kind?: string;
    instance?: number;
}
export interface ProjectileSnapshot extends MotionSnapshot {
    death: boolean;
    status: GameState['status'];
}

export type CanvasPaint = string | CanvasGradient | CanvasPattern;
export type VectorPath = readonly number[][];
