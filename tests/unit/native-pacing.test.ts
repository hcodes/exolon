import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AMIGA_SCREEN_PAL_FRAMES } from '../../src/games/amiga/constants/pacing.ts';
import { ATARI_ST_SCREEN_PAL_FRAMES } from '../../src/games/atari-st/constants/pacing.ts';

interface PlatformTiming {
    cpuHz: number;
    palHz: number;
    screens: { screenIndex: number; cycles: number[] }[];
}
const source = JSON.parse(
    readFileSync(new URL('../../research/native-scene-pacing.json', import.meta.url), 'utf8'),
) as { platforms: Record<'amiga' | 'atari-st', PlatformTiming> };

for (const [name, frames] of [
    ['amiga', AMIGA_SCREEN_PAL_FRAMES],
    ['atari-st', ATARI_ST_SCREEN_PAL_FRAMES],
] as const) {
    test(`${name} scene pacing covers original CPU work without adding an extra refresh`, () => {
        const original = source.platforms[name];
        assert.equal(frames.length, 125);
        assert.equal(original.screens.length, 125);
        for (const screen of original.screens) {
            const budget = frames[screen.screenIndex];
            const work = Math.min(...screen.cycles);
            assert.ok(Number.isInteger(budget) && budget >= 3);
            assert.ok(
                (budget * original.cpuHz) / original.palHz >= work,
                `screen ${screen.screenIndex + 1}: CPU work must fit the chosen refresh budget`,
            );
            if (budget > 3)
                assert.ok(
                    ((budget - 1) * original.cpuHz) / original.palHz < work,
                    `screen ${screen.screenIndex + 1}: the shorter budget cannot fit source work`,
                );
        }
    });
}
