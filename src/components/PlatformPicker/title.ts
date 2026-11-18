export const PICKER_TITLE_REVEAL_MS = 2400;
const FALL_MS = 450;

interface TitleGrain {
    x: number;
    y: number;
    release: number;
    settled: boolean;
}

function scatter(seed: number) {
    let value = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

export function createTitleGrains(pixels: Uint8ClampedArray, width: number, height: number) {
    const grains: TitleGrain[] = [];
    for (let x = 0; x < width; x++) {
        const column: number[] = [];
        for (let y = height - 1; y >= 0; y--) if (pixels[(y * width + x) * 4 + 3]) column.push(y);
        // Stagger neighbouring streams without changing their order on resize.
        const delay = 100 + scatter(x + 1) * 250;
        for (let rank = 0; rank < column.length; rank++) {
            const jitter =
                rank > 0 && rank < column.length - 1 ? scatter((x + 1) * 127 + rank) * 0.45 : 0;
            grains.push({
                x,
                y: column[rank],
                release: delay + ((rank + jitter) / Math.max(1, column.length - 1)) * 1300,
                settled: false,
            });
        }
    }
    return grains;
}

export function drawPickerTitle(
    context: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    settled: CanvasRenderingContext2D,
    grains: ReturnType<typeof createTitleGrains>,
    time: number,
) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    for (const grain of grains) {
        if (grain.settled || time < grain.release) continue;
        const progress = Math.min(1, (time - grain.release) / FALL_MS);
        if (progress === 1) {
            settled.drawImage(source, grain.x, grain.y, 1, 1, grain.x, grain.y, 1, 1);
            grain.settled = true;
        } else {
            // One grain, one source pixel: accelerate downwards without a trail.
            const y = Math.floor(-2 + (grain.y + 2) * progress * progress);
            context.drawImage(source, grain.x, grain.y, 1, 1, grain.x, y, 1, 1);
        }
    }
    // Copy the cached word instead of repainting settled grains individually.
    context.drawImage(settled.canvas, 0, 0);
}

export function drawPickerTitleShine(
    context: CanvasRenderingContext2D,
    settled: HTMLCanvasElement,
    time: number,
    animated: boolean,
) {
    const { width, height } = context.canvas;
    context.clearRect(0, 0, width, height);
    context.drawImage(settled, 0, 0);
    const phase = (time % 6000) / 6000;
    if (!animated || phase <= 0.2 || phase >= 0.65) return;
    const progress = (1 - Math.cos(((phase - 0.2) / 0.45) * Math.PI)) / 2;
    const center = width * (1.5 - progress * 2);
    const shine = context.createLinearGradient(
        center - width * 0.2,
        0,
        center + width * 0.2,
        height,
    );
    shine.addColorStop(0, 'rgba(255, 245, 214, 0)');
    shine.addColorStop(0.35, 'rgba(255, 245, 214, 0.6)');
    shine.addColorStop(0.5, '#ffffff');
    shine.addColorStop(0.65, 'rgba(255, 245, 214, 0.6)');
    shine.addColorStop(1, 'rgba(255, 245, 214, 0)');
    context.save();
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = shine;
    context.fillRect(0, 0, width, height);
    context.restore();
}
