// Canvas coordinates and timing shared by application controls and presentation.
export const SCREEN_WIDTH = 256;
export const SCREEN_HEIGHT = 192;
export const SCREEN_COUNT = 125;
export const STAGE_SCREEN_COUNT = 25;
// Source walking measurements and limits: ../../research/gameplay-timing.md.
export const SIMULATION_INTERVAL = 47;
export function getSimulationInterval(mode: string): number {
    switch (mode) {
        case 'cpc':
            return 52;
        case 'c64':
            return 47;
        case 'sharp-mz800':
            return 45;
        case 'remastered':
        case 'gameboy':
        case 'gameboy-color':
            return 1000 / 30;
        default:
            return SIMULATION_INTERVAL;
    }
}
