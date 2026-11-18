/** $ef06/$ef4a: exact unsigned two-longword recurrence without BigInt.
 * Original initial seeds came from hardware counters. Cosmetic random calls are
 * omitted by gameplay, so this is not a full ROM trace. Cosmetic stars use the native
 * $ef4a divisor65535; the gameplay caller retains its existing byte-range reduction. */
export function nextAmigaRandom(
    state: { randomSeed: number; randomSeedHigh: number },
    modulus = 255,
): number {
    const low = ((state.randomSeed & 0xffffff00) | (state.randomSeed & 14) | 32) >>> 0;
    const high = state.randomSeedHigh;
    const twiceLow = (low * 2) >>> 0;
    const twiceHigh = (high * 2 + (low >>> 31)) >>> 0;
    const threeLow = (twiceLow + low) >>> 0;
    const threeHigh = (twiceHigh + high + (twiceLow + low > 0xffffffff ? 1 : 0)) >>> 0;
    const shiftedLow = (twiceLow << 16) >>> 0;
    const shiftedHigh = ((twiceHigh << 16) | (twiceLow >>> 16)) >>> 0;
    state.randomSeed = (threeLow + shiftedLow) >>> 0;
    state.randomSeedHigh =
        (threeHigh + shiftedHigh + (threeLow + shiftedLow > 0xffffffff ? 1 : 0)) >>> 0;
    return (state.randomSeedHigh >>> 16) % modulus;
}
