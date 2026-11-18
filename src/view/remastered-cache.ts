import type { Contours } from '../types/graphics.ts';

/** Only the current scene owns raster layers; changing scenes releases their backing stores. */
export function createRemasteredLayerCache(document: Document, scale: 2 | 4) {
    const layers = new Map<number, HTMLCanvasElement>();
    let revision: object | null = null;
    let geometry: Contours | undefined;
    function reset() {
        for (const layer of layers.values()) {
            layer.width = 0;
            layer.height = 0;
        }
        layers.clear();
        revision = null;
        geometry = undefined;
    }
    return {
        prepare(scene: object, contours: Contours | undefined) {
            if (revision === scene && geometry === contours) return;
            reset();
            revision = scene;
            geometry = contours;
        },
        draw(
            context: CanvasRenderingContext2D,
            id: number,
            paint: (context: CanvasRenderingContext2D) => void,
        ) {
            let layer = layers.get(id);
            if (!layer) {
                layer = document.createElement('canvas');
                layer.width = 256 * scale;
                layer.height = 176 * scale;
                // Intermediate layers need transparent gaps for stars, animation and actors.
                const source = layer.getContext('2d')!;
                source.setTransform(scale, 0, 0, scale, 0, 0);
                source.lineJoin = 'round';
                source.lineCap = 'round';
                paint(source);
                layers.set(id, layer);
            }
            context.drawImage(layer, 0, 0, 256, 176);
        },
        reset,
    };
}

export type RemasteredLayerCache = ReturnType<typeof createRemasteredLayerCache>;
