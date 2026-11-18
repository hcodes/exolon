export interface NativeScreen {
    readonly tiles: readonly number[];
}
export interface NativeWorld {
    readonly screens: readonly NativeScreen[];
}
export interface NativeCommands {
    left?: boolean;
    right?: boolean;
    jump?: boolean;
    duck?: boolean;
    fire?: boolean;
    firePressed?: boolean;
    chargeRocket?: boolean;
    rocket?: boolean;
}
export interface NativeOptions {
    screenIndex?: number;
    seed?: number;
    seedHigh?: number;
    invulnerable?: boolean;
    infiniteLives?: boolean;
    infiniteAmmo?: boolean;
    infiniteGrenades?: boolean;
    levelSelection?: boolean;
    restartSameLevel?: boolean;
}
export type NativeEntityKind =
    | 'bullet'
    | 'grenade'
    | 'rocket-trail'
    | 'flyer'
    | 'pod'
    | 'pod-particle'
    | 'turret'
    | 'enemy-bullet'
    | 'barrier'
    | 'spike'
    | 'mine'
    | 'pickup'
    | 'teleport'
    | 'laser'
    | 'explosion'
    | 'debris'
    | 'hunter';
/** Entity positions use display pixels. Player y retains the original bottom anchor. */
export interface NativeEntity {
    id: number;
    kind: NativeEntityKind;
    x: number;
    y: number;
    width: number;
    height: number;
    frame: number;
    type: number;
    alive: boolean;
    phase: number;
    dx: number;
    dy: number;
    life?: number;
    parentId?: number;
    health?: number;
    path?: number;
    sourceX?: number;
    sourceY?: number;
}
export interface NativePlayer {
    x: number;
    y: number;
    pose: number;
    facing: 'left' | 'right';
    ducked: boolean;
    jumpKind: 0 | 1 | 2 | 3;
    jumpIndex: number;
    deathTick: number;
    invulnerableTicks: number;
    armored: boolean;
    spawnX: number;
    spawnY: number;
    deathX: number;
    deathY: number;
}
export interface NativeState {
    world: NativeWorld;
    options: NativeOptions;
    screenIndex: number;
    status: 'playing' | 'over' | 'won' | 'bonus';
    tick: number;
    score: number;
    lives: number;
    ammo: number;
    grenades: number;
    player: NativePlayer;
    entities: NativeEntity[];
    tiles: number[];
    fireHeld: boolean;
    fireTicks: number;
    nextEntityId: number;
    randomSeed: number;
    randomSeedHigh: number;
    bonusTicks: number;
    bonusPhase: 'summary' | 'ending' | 'roulette';
    pendingScore: number;
    bonusClaimed: boolean;
    hunterTicks: number;
    /** Native $f0b4: 0..12 pending effect frames, 13 idle. */
    teleportPhase: number;
    /** Frame drawn during this update, or -1 without an overlay. */
    teleportFrame: number;
}
export type NativeEventType =
    | 'shot'
    | 'grenade'
    | 'rocket-trail'
    | 'explosion'
    | 'death'
    | 'pickup'
    | 'armor'
    | 'teleport'
    | 'screen'
    | 'bonus'
    | 'won'
    | 'over'
    | 'enemy-shot';
export interface NativeEvent {
    type: NativeEventType;
    x?: number;
    y?: number;
    value?: number;
}
export interface NativeStep {
    state: NativeState;
    events: NativeEvent[];
}
