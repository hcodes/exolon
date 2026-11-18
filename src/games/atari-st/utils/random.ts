/** TOS 1.02 $fc1510: XBIOS Random, followed by the game's $14952 byte mask.
 * The state holds an initialized OS seed. Browser initialization is deterministic;
 * the original zero-seed initialization from the hardware timer is not emulated. */
export function nextAtariStRandomByte(state: { randomSeed: number }): number {
    state.randomSeed = (Math.imul(state.randomSeed, 0xbb40e62d) + 1) >>> 0;
    return (state.randomSeed >>> 8) & 255;
}
