import { createEventScope } from '../lib/events.ts';
import {
    createTitleGrains,
    drawPickerTitle,
    drawPickerTitleShine,
    PICKER_TITLE_REVEAL_MS,
} from '../components/PlatformPicker/title.ts';

export function createPickerTitle({
    document,
    window,
    animated = true,
}: {
    document: Document;
    window: Window & typeof globalThis;
    animated?: boolean;
}) {
    if (!animated) return () => {};
    const heading = document.querySelector<HTMLElement>('.platform-picker__heading')!;
    const reducedMotion =
        typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : undefined;
    if (reducedMotion?.matches) return () => {};
    const canvas = document.createElement('canvas');
    const source = document.createElement('canvas');
    const settled = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const sourceContext = source.getContext('2d');
    const settledContext = settled.getContext('2d');
    if (!context || !sourceContext || !settledContext) return () => {};
    const events = createEventScope(window);
    const text = heading.textContent!.trim();
    canvas.className = 'platform-picker__title-raster';
    canvas.setAttribute('aria-hidden', 'true');
    let grains: ReturnType<typeof createTitleGrains> = [];
    let elapsed = 0;
    let previousTime: number | undefined;
    let frame: number | undefined;
    let suspended = false;
    let disposed = false;
    let assembled = false;

    function rasterize() {
        const style = window.getComputedStyle(heading);
        const bounds = heading.getBoundingClientRect();
        // Measure the actual DOM baseline, including the browser's font fallback.
        const marker = document.createElement('span');
        marker.className = 'platform-picker__title-baseline';
        heading.appendChild(marker);
        const baseline = marker.getBoundingClientRect().top - bounds.top;
        heading.removeChild(marker);
        canvas.width = source.width = settled.width = Math.ceil(bounds.width);
        canvas.height = source.height = settled.height = Math.ceil(bounds.height);
        sourceContext!.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        sourceContext!.fillStyle = '#e8d6a6';
        const spacing = parseFloat(style.letterSpacing) || 0;
        // Canvas letterSpacing is unavailable on compatible Safari; place glyphs
        // explicitly while retaining the font's kerning in each measured prefix.
        for (let index = 0; index < text.length; index++) {
            const x =
                sourceContext!.measureText(text.slice(0, index + 1)).width -
                sourceContext!.measureText(text[index]).width +
                index * spacing;
            sourceContext!.fillText(text[index], x, baseline);
        }
        const pixels = sourceContext!.getImageData(0, 0, source.width, source.height).data;
        grains = createTitleGrains(pixels, source.width, source.height);
        assembled = false;
        context!.imageSmoothingEnabled = false;
        settledContext!.imageSmoothingEnabled = false;
    }
    function draw() {
        if (!assembled) {
            drawPickerTitle(context!, source, settledContext!, grains, elapsed);
            if (elapsed >= PICKER_TITLE_REVEAL_MS) {
                assembled = true;
                heading.classList.remove('platform-picker__heading_revealing');
            }
        }
        if (assembled) {
            drawPickerTitleShine(
                context!,
                settled,
                elapsed - PICKER_TITLE_REVEAL_MS,
                !reducedMotion?.matches,
            );
        }
    }
    function stop() {
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        frame = undefined;
        previousTime = undefined;
    }
    function destroy() {
        if (disposed) return;
        disposed = true;
        stop();
        events.destroy();
        heading.classList.remove('platform-picker__heading_revealing');
        heading.classList.remove('platform-picker__heading_raster');
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
    function animate(time: number) {
        frame = undefined;
        if (disposed || suspended || document.hidden) return;
        if (previousTime !== undefined) elapsed += time - previousTime;
        previousTime = time;
        draw();
        frame = window.requestAnimationFrame(animate);
    }
    function refresh() {
        if (disposed) return;
        stop();
        if (reducedMotion?.matches) {
            elapsed = Math.max(elapsed, PICKER_TITLE_REVEAL_MS);
        }
        if (suspended || document.hidden) return;
        rasterize();
        if (!grains.length) {
            destroy();
            return;
        }
        draw();
        if (!reducedMotion?.matches) frame = window.requestAnimationFrame(animate);
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
    heading.appendChild(canvas);
    heading.classList.add('platform-picker__heading_raster');
    heading.classList.add('platform-picker__heading_revealing');
    refresh();
    return destroy;
}
