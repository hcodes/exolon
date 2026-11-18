import { createNativeRenderer } from '../../16bit/view/renderer.ts';
import type { NativeGraphics } from '../../16bit/types/graphics.ts';
import type { NativeWorld } from '../../16bit/types/world.ts';
export function createAtariStRenderer(
    canvas: HTMLCanvasElement,
    graphics: NativeGraphics,
    world: NativeWorld,
) {
    return createNativeRenderer(canvas, graphics, world, 'atari-st');
}
