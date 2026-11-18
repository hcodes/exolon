export const PICKER_STAR_DRIFT_DURATIONS = [36, 31, 27, 23, 20, 17, 14, 11.5, 9.5, 8] as const;

const depths = [
    {
        opacity: 0.55,
        stops: [
            [0, 0.45],
            [0.82, 0.45],
            [0.84, 1],
            [0.89, 0.45],
            [1, 0.45],
        ],
    },
    {
        opacity: 0.78,
        stops: [
            [0, 0.6],
            [0.82, 0.6],
            [0.84, 1],
            [0.89, 0.6],
            [1, 0.6],
        ],
    },
    {
        opacity: 0.94,
        stops: [
            [0, 0.72],
            [0.82, 0.72],
            [0.84, 1],
            [0.89, 0.72],
            [1, 0.72],
        ],
    },
] as const;
const layers = PICKER_STAR_DRIFT_DURATIONS.map((duration, index) => ({
    drift: duration * 1000,
    twinkle: (4.8 - index * 0.22) * 1000,
    delay: index * 700,
    depth: depths[index < 4 ? 0 : index < 7 ? 1 : 2],
}));

export function drawPickerStars(
    context: CanvasRenderingContext2D,
    tiles: readonly (CanvasImageSource | undefined)[],
    width: number,
    height: number,
    time: number,
    animated: boolean,
) {
    context.clearRect(0, 0, width, height);
    const y = Math.round((height - 96) / 2);
    for (let index = 0; index < layers.length; index++) {
        const tile = tiles[index];
        if (!tile) continue;
        const layer = layers[index];
        let opacity: number = layer.depth.opacity;
        if (animated) {
            const phase = ((time + layer.delay) % layer.twinkle) / layer.twinkle;
            const stops = layer.depth.stops;
            for (let stop = 1; stop < stops.length; stop++) {
                const [end, to] = stops[stop];
                if (phase > end) continue;
                const [start, from] = stops[stop - 1];
                const progress = (phase - start) / (end - start);
                opacity = from + (to - from) * ((1 - Math.cos(progress * Math.PI)) / 2);
                break;
            }
        }
        context.globalAlpha = opacity;
        const offset = animated ? ((time % layer.drift) / layer.drift) * 640 : 0;
        for (let x = offset - 640; x < width; x += 640) context.drawImage(tile, x, y);
    }
    context.globalAlpha = 1;
}
