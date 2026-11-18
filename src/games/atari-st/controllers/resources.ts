import { validateNativeResources } from '../../16bit/controllers/resources.ts';
export function validateAtariStResources(world: unknown, graphics: unknown) {
    const result = validateNativeResources(world, graphics, 'Atari ST');
    if (!result.graphics.asciiFont) throw new Error('Missing original Atari ST text font.');
    return result;
}
