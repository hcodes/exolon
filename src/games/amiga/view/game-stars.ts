import type { AmigaGraphics } from '../../../assets/graphics/amiga/types.ts';
import { nextAmigaRandom } from '../utils/random.ts';

/** Native $c18e: one eight-phase8x7 sparkle, masked by occupied scene pixels.
 * A separate fixed seed keeps cosmetic calls independent of gameplay RNG. */
export function createAmigaGameStar() {
    let screen = -1;
    let tick = 0;
    let random = { randomSeed: 0x19871201, randomSeedHigh: 0x12345678 };
    let active = false;
    let phase = 0;
    let x = 0;
    let y = 0;
    const sample = (mask: number, limit: number) => {
        let value: number;
        do value = nextAmigaRandom(random, 65535) & mask;
        while (value >= limit);
        return value;
    };
    return {
        draw(pixels: Uint8Array, graphics: AmigaGraphics, screenIndex: number, nextTick: number) {
            if (screenIndex !== screen || nextTick < tick) {
                screen = screenIndex;
                tick = 0;
                active = false;
                phase = 0;
                random = {
                    randomSeed: (0x19871201 + screenIndex) >>> 0,
                    randomSeedHigh: 0x12345678,
                };
            }
            while (tick < nextTick) {
                tick++;
                if (!active) {
                    if (sample(255, 176) >= 65) continue;
                    y = sample(255, 176);
                    x = sample(4095, 320) & ~15;
                    active = true;
                    phase = 0;
                }
                if (phase >= 8) active = false;
                else phase++;
            }
            if (!active) return;
            const frame = graphics.resources['game-stars'].frames[phase];
            for (let row = 0; row < 7; row++)
                for (let col = 0; col < 8; col++) {
                    const offset = (y + row) * 320 + x + col;
                    if (!pixels[offset]) pixels[offset] = frame[row * 8 + col];
                }
        },
    };
}
