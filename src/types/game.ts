// Domain coordinates use the original two-pixel horizontal units unless noted.
export interface Point {
    x: number;
    y: number;
}
export type Direction = 'left' | 'right' | 'up' | 'down';
export type CheatKey =
    | 'infiniteLives'
    | 'infiniteRockets'
    | 'infiniteAmmo'
    | 'invulnerable'
    | 'levelSelection'
    | 'retryLevel';
export type Cheats = Record<CheatKey, boolean>;
export interface InputCommands {
    left?: boolean;
    right?: boolean;
    jump?: boolean;
    duck?: boolean;
    fire?: boolean;
    firePressed?: boolean;
    chargeRocket?: boolean;
    rocket?: boolean;
}

export interface Tile {
    collision: number;
    block: number;
    instance?: number;
    color?: number;
    overlay?: number;
    glyph?: number;
    ink?: boolean;
    shape?: number;
}
export interface Placement extends Point {
    block: number;
}
export interface MapObject extends Point {
    id: number;
    type: number;
    instance?: number;
    block?: number;
}
export interface ScreenAction extends Point {
    type: number;
    instance?: number;
    block?: number;
}
export interface GameScreen {
    id?: number;
    address?: number;
    tiles: (Tile | null)[];
    placements?: Placement[];
    actions?: ScreenAction[];
    objects?: MapObject[];
}
export interface EnemyDefinition {
    screen: number;
    sprite: number;
    delay: number;
    trajectory: number[][];
}
export interface PumpTile extends Point {
    color: number;
    ink: boolean;
    shape: number;
}
export interface World {
    screens: GameScreen[];
    enemies?: EnemyDefinition[];
    blockNames?: string[];
    contours?: number[][][][];
    pump?: { width: number; height: number; tiles: PumpTile[] };
}
export interface ScreenObject extends MapObject {
    active: boolean;
    phase: number;
    hits: number;
    length: number;
    yOffset: number;
}
export interface Player extends Point {
    direction: number;
    jump: number;
    walk: number;
    duck: boolean;
    falling: boolean;
    sprite: number;
    walkPhase: number;
}
export interface Bullet extends Point {
    dx: number;
}
export interface EnemyBullet extends Point {
    dx?: number;
}
export interface Grenade extends Bullet {
    phase: number;
    projectileId?: number;
}
export interface Rocket extends Point {
    kind: 'launcher' | 'homing';
    dx: number;
    instance?: number;
    projectileId?: number;
}
export interface Sphere extends Bullet {
    kind: 'sphere';
}
export interface FlyingEnemy extends Point {
    kind: 'flying';
    sprite: number;
    color?: number;
    phase: number;
    trajectory: number[][];
    trajectoryIndex: number;
}
export type Projectile = Bullet | EnemyBullet | Grenade | Rocket | Sphere;
export interface StageBonus {
    cursor: number;
    armed: boolean;
    base: number;
    lives: number;
    bravery: number;
    lifePoints: number;
    braveryPoints: number;
    total: number;
    roulette?: number;
}
export type GameStatus = 'playing' | 'bonus' | 'over' | 'won';
export interface GameState {
    world: World;
    screen: GameScreen;
    screenIndex: number;
    stage: number;
    level: number;
    tick: number;
    screenTicks: number;
    nextProjectileId: number;
    player: Player;
    entrance: Point;
    ammo: number;
    grenades: number;
    lives: number;
    score: number;
    fireTicks: number;
    exoskeleton: boolean;
    upHeld: boolean;
    turretPhase: number;
    seed: number;
    death: number;
    invulnerable: number;
    bonus: StageBonus | null;
    status: GameStatus;
    cheats: Cheats;
    cheatMode: boolean;
    cheatUsed: boolean;
    bullets: Bullet[];
    grenade: Grenade | null;
    enemyBullets: EnemyBullet[];
    rockets: Rocket[];
    spheres: Sphere[];
    enemies: FlyingEnemy[];
    killer: Point | null;
    destroyed: number[];
    enemyDelay: number;
    objects: ScreenObject[];
}
export type GameEventType =
    | 'death'
    | 'suit'
    | 'teleport'
    | 'teleport-arrive'
    | 'refill'
    | 'bonus'
    | 'shot'
    | 'grenade'
    | 'enemy-destroyed'
    | 'hit'
    | 'explosion'
    | 'object-destroyed'
    | 'turret'
    | 'rocket'
    | 'mine'
    | 'stage'
    | 'victory'
    | 'screen'
    | 'game-over'
    | 'respawn';
// Events expose pixel coordinates, unlike model positions.
export interface GameEvent extends Point {
    type: GameEventType;
    enabled?: boolean;
    supply?: 'ammo' | 'grenades';
    points?: number;
    weapon?: 'bullet' | 'rocket';
    instance?: number;
    stage?: number;
    screenIndex?: number;
    level?: number;
    cursor?: number;
    armed?: boolean;
    base?: number;
    lives?: number;
    bravery?: number;
    lifePoints?: number;
    braveryPoints?: number;
    total?: number;
    roulette?: number;
}
export interface CreateStateOptions {
    screenIndex?: number;
    cheats?: unknown;
    cheatMode?: unknown;
}
export interface RestartStateOptions {
    initialScreen?: number;
    selectedScreen?: number;
}
export interface StepResult {
    state: GameState;
    events: GameEvent[];
}
