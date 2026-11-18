import { createEventScope } from '../lib/events.ts';
import { versionAssetUrl } from '../services/asset-url.ts';
import {
    drawPickerStars,
    PICKER_STAR_DRIFT_DURATIONS,
} from '../components/PlatformPicker/stars.ts';

export function createPickerStars({
    document,
    window,
    animated = true,
}: {
    document: Document;
    window: Window & typeof globalThis;
    animated?: boolean;
}) {
    const canvas = document.querySelector<HTMLCanvasElement>('.platform-picker__stars')!;
    const context = canvas.getContext('2d');
    if (!context) return () => {};
    const events = createEventScope(window);
    const reducedMotion =
        typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : undefined;
    const tiles: (HTMLCanvasElement | undefined)[] = [];
    let frame: number | undefined;
    let previousTime: number | undefined;
    let elapsed = 0;
    let ready = 0;
    let suspended = false;
    let disposed = false;

    function draw() {
        drawPickerStars(
            context!,
            tiles,
            canvas.width,
            canvas.height,
            elapsed,
            animated && !reducedMotion?.matches,
        );
    }
    function canAnimate() {
        return (
            animated &&
            !disposed &&
            !suspended &&
            !document.hidden &&
            !reducedMotion?.matches &&
            ready > 0
        );
    }
    function animate(time: number) {
        frame = undefined;
        if (!canAnimate()) return;
        if (previousTime !== undefined) elapsed += time - previousTime;
        previousTime = time;
        draw();
        frame = window.requestAnimationFrame(animate);
    }
    function stop() {
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        frame = undefined;
        previousTime = undefined;
    }
    function refresh() {
        if (disposed) return;
        stop();
        if (suspended || document.hidden) return;
        const bounds = canvas.getBoundingClientRect();
        // One bitmap pixel per CSS pixel keeps the original tiny pixel stars and
        // bounds the work on high-DPI phones without a full-screen backing store.
        const width = Math.ceil(bounds.width);
        const height = Math.ceil(bounds.height);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        context!.imageSmoothingEnabled = false;
        draw();
        if (canAnimate()) frame = window.requestAnimationFrame(animate);
    }
    function handlePageHide() {
        suspended = true;
        stop();
    }
    function handlePageShow() {
        suspended = false;
        refresh();
    }
    events.on(window, 'resize', refresh);
    events.on(document, 'visibilitychange', refresh);
    events.on(reducedMotion, 'change', refresh);
    events.on(window, 'pagehide', handlePageHide);
    events.on(window, 'pageshow', handlePageShow);
    for (let index = 0; index < PICKER_STAR_DRIFT_DURATIONS.length; index++) {
        const image = new window.Image();
        function handleLoad() {
            if (disposed) return;
            const tile = document.createElement('canvas');
            tile.width = 640;
            tile.height = 96;
            const tileContext = tile.getContext('2d');
            if (!tileContext) return;
            // Rasterize each SVG once; animation only copies the cached bitmap.
            tileContext.drawImage(image, 0, 0);
            tiles[index] = tile;
            ready++;
            refresh();
        }
        events.on(image, 'load', handleLoad);
        image.src = versionAssetUrl(`assets/images/shared/pixel-stars-${index + 1}.svg`);
    }
    refresh();
    function destroy() {
        disposed = true;
        stop();
        events.destroy();
    }
    return destroy;
}
