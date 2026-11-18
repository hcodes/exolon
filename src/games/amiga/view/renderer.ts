import { createNativeRenderer } from '../../16bit/view/renderer.ts';
export {
    blitAmigaShape,
    amigaRgba,
    drawAmigaStars,
    composeAmigaScene,
    drawAmigaText,
} from '../../16bit/view/renderer.ts';
export type { NativePresentation as AmigaPresentation } from '../../16bit/view/renderer.ts';
import type { AmigaGraphics } from '../../../assets/graphics/amiga/types.ts';
import type { AmigaWorld } from '../data/types.ts';
export function createAmigaRenderer(
    canvas: HTMLCanvasElement,
    graphics: AmigaGraphics,
    world: AmigaWorld,
) {
    return createNativeRenderer(canvas, graphics, world, 'amiga');
}
