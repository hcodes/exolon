import type { AmigaGraphics } from '../../../assets/graphics/amiga/types.ts';
import { nextAmigaRandom } from '../utils/random.ts';

/** Original $96f0: allocate one of ten slots, then advance/erase seven16px frames.
 * The hardware-clock RNG seed is fixed for reproducible browser presentation. */
export function createAmigaMenuStars(graphics: AmigaGraphics) {
    const random = { randomSeed: 0x19871201, randomSeedHigh: 0x12345678 };
    const slots = Array.from({ length: 10 }, () => ({ x: 0, y: 0, phase: 0, active: false }));
    const stars = new Uint8Array(64000);
    const frames = graphics.resources['menu-stars'].frames;
    let updates = 0;
    return {
        render(pixels: Uint8Array, step: number) {
            while (updates < step) {
                const slot = slots.find((candidate) => !candidate.active);
                if (slot) {
                    let x: number, y: number;
                    do {
                        x =
                            (nextAmigaRandom(random, 65535) & 15) +
                            (nextAmigaRandom(random, 65535) & 3);
                        y = nextAmigaRandom(random, 65535) & 15;
                        if (y >= 12) y -= 4;
                    } while (x > 19 || y >= 11 || (y >= 1 && y < 9 && x >= 3 && x < 17));
                    slot.x = x * 16;
                    slot.y = y * 16;
                    slot.phase = 0;
                    slot.active = true;
                }
                for (const star of slots) {
                    if (!star.active) continue;
                    const frame = star.phase === 7 ? undefined : frames[star.phase];
                    for (let y = 0; y < 16; y++)
                        for (let x = 0; x < 16; x++)
                            stars[(star.y + y) * 320 + star.x + x] = frame?.[y * 16 + x] ?? 0;
                    if (star.phase === 7) star.active = false;
                    else star.phase++;
                }
                updates++;
            }
            for (let i = 0; i < stars.length; i++) if (stars[i]) pixels[i] = stars[i];
        },
    };
}
