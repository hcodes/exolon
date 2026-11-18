// Original rule tables: Raffaele Cecco / Sergey Erokhin (ESL), CC BY-SA 3.0.
// Units and provenance: ../../research/behavior.md.
export const JUMP = [-4, -4, -2, -2, -2, -1, -1, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 4, 4];
// Source table at 0x9D4A is indexed by the death countdown, from its end.
export const DEATH_Y = [
    ...Array(26).fill(4),
    2,
    2,
    2,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    -1,
    -1,
    -1,
    -1,
    -2,
    -2,
    -2,
    -4,
    -4,
];
export const GRENADE = [1, ...Array(22).fill(0), -1, -1, -1, -1, -2, -2, -2, -4, -4];
export const SOLID = [0, 1, 0, 3, 0, 1, 1, 0, 0, 0, 1, 0, 1, 13, 0, 0, 0, 1];
export const STAGE_START = [
    [16, 112],
    [0, 120],
    [0, 32],
    [40, 128],
    [16, 112],
];
export const DESTROYABLE: Partial<Record<number, [number, number, number, number]>> = {
    5: [-1, 8, -2, 5],
    13: [-3, 5, -2, 10],
    15: [-2, 7, -1, 9],
    16: [-2, 6, -2, 8],
    18: [-6, 11, 1, 7],
    21: [-2, 7, -2, 8],
    31: [-1, 6, -2, 6],
    40: [-1, 6, -2, 8],
    44: [-1, 8, -2, 4],
    46: [-1, 5, -2, 6],
};

export const CHEAT_KEYS = [
    'infiniteLives',
    'infiniteRockets',
    'infiniteAmmo',
    'invulnerable',
    'levelSelection',
    'retryLevel',
] as const;
