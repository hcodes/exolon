export const GRAPHICS_MODES = Object.freeze([
    'retro',
    'remastered',
    'split',
    'c64',
    'cpc',
    'sharp-mz800',
    'gameboy',
    'gameboy-color',
] as const);
export const SPLIT_SIDES = Object.freeze(['left', 'right'] as const);
export const OPTIONAL_GRAPHICS = Object.freeze([
    ['c64', 'setC64Graphics'],
    ['cpc', 'setCpcGraphics'],
    ['sharp-mz800', 'setSharpGraphics'],
] as const);
