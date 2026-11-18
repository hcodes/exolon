import type { ScopedPointerEvent } from '../lib/events.ts';
import { createEventScope } from '../lib/events.ts';

// A wipe boundary over the actual contained game image, including Fullscreen
// letterboxing. It changes presentation only, never simulation coordinates.
export function createSplitControl(
    button: HTMLButtonElement,
    canvas: HTMLCanvasElement,
    {
        onChange,
        onInteraction,
    }: { onChange?: (position: number) => void; onInteraction?: () => void } = {},
) {
    const view = canvas.ownerDocument.defaultView;
    const listeners = createEventScope(view);
    let enabled = false,
        position = 0.5,
        pointer: number | null = null,
        lastLayout = '';
    let leftLabel = 'ZX Spectrum',
        rightLabel = 'Remastered';
    function updateLabels() {
        const percent = Math.round(position * 100);
        button.setAttribute('aria-label', `Boundary between ${leftLabel} and ${rightLabel}`);
        button.setAttribute(
            'aria-valuetext',
            `${leftLabel} ${percent}%, ${rightLabel} ${100 - percent}%`,
        );
    }
    function imageBounds() {
        const box = canvas.getBoundingClientRect(),
            width = Math.min(box.width, (box.height * 4) / 3),
            height = (width * 3) / 4;
        return {
            left: box.left + (box.width - width) / 2,
            top: box.top + (box.height - height) / 2,
            width,
            height,
        };
    }
    function refresh() {
        if (!enabled) return;
        const image = imageBounds(),
            parent = canvas.parentElement!.getBoundingClientRect();
        const x = image.left - parent.left + image.width * position,
            y = image.top - parent.top;
        const layout = `${x}:${y}:${image.height}`;
        if (layout === lastLayout) return;
        lastLayout = layout;
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        button.style.height = `${image.height}px`;
    }
    function setPosition(value: number) {
        if (!Number.isFinite(value)) return;
        position = Math.max(0, Math.min(1, value));
        const percent = Math.round(position * 100);
        button.setAttribute('aria-valuenow', String(percent));
        updateLabels();
        refresh();
        onChange?.(position);
    }
    function move(event: ScopedPointerEvent) {
        if (!enabled || event.pointerId !== pointer) return;
        const image = imageBounds();
        if (image.width > 0) setPosition((event.clientX - image.left) / image.width);
    }
    function cancel() {
        const captured = pointer;
        pointer = null;
        if (captured !== null && button.hasPointerCapture?.(captured))
            button.releasePointerCapture(captured);
    }
    function handlePointerDown(event: ScopedPointerEvent) {
        if (!enabled || pointer !== null || event.button !== 0) return;
        event.preventDefault();
        button.focus({ preventScroll: true });
        onInteraction?.();
        pointer = event.pointerId;
        try {
            button.setPointerCapture?.(pointer);
        } catch {
            /* Touch fallback uses the window move/release listeners. */
        }
        move(event);
    }
    listeners.on(button, 'pointerdown', handlePointerDown);
    listeners.on(view, 'pointermove', move);
    function handlePointerRelease(event: ScopedPointerEvent) {
        if (event.pointerId === pointer) cancel();
    }
    for (const type of ['pointerup', 'pointercancel'] as const)
        listeners.on(view, type, handlePointerRelease);
    listeners.on(button, 'lostpointercapture', handlePointerRelease);
    listeners.on(view, 'blur', cancel);
    function handleKeyDown(event: KeyboardEvent) {
        if (!enabled) return;
        const changes: Record<string, number> = {
            ArrowLeft: -0.02,
            ArrowDown: -0.02,
            ArrowRight: 0.02,
            ArrowUp: 0.02,
            PageDown: -0.1,
            PageUp: 0.1,
        };
        if (event.key !== 'Home' && event.key !== 'End' && !(event.key in changes)) return;
        event.preventDefault();
        onInteraction?.();
        setPosition(
            event.key === 'Home' ? 0 : event.key === 'End' ? 1 : position + changes[event.key],
        );
    }
    listeners.on(button, 'keydown', handleKeyDown);
    setPosition(0.5);
    return {
        setPosition,
        get position() {
            return position;
        },
        setLabels(left: string, right: string) {
            leftLabel = left;
            rightLabel = right;
            updateLabels();
        },
        setEnabled(value: boolean) {
            enabled = Boolean(value);
            button.hidden = !enabled;
            if (!enabled) cancel();
            lastLayout = '';
            refresh();
        },
        refresh,
        destroy() {
            cancel();
            listeners.destroy();
        },
    };
}
