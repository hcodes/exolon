import type { createRenderer } from '../view/renderer.ts';
import type { createSplitControl } from './split.ts';
import type { EventScope } from '../lib/events.ts';
import type { PreferenceStore } from '../types/ui.ts';
import { readSplitPair } from '../utils/split-pair.ts';
import { GRAPHICS_MODES, SPLIT_SIDES } from '../constants/graphics.ts';

interface GraphicsOptions {
    select: HTMLSelectElement;
    options: HTMLElement;
    left: HTMLSelectElement;
    right: HTMLSelectElement;
    splitControl: ReturnType<typeof createSplitControl>;
    storage: PreferenceStore;
    events: EventScope;
    onActivity: () => void;
    onInteraction: () => void;
    onAudioMode: (mode: string) => void;
    onChooseClassic?: (mode: string) => void;
    onChooseNative?: (mode: 'amiga' | 'atari-st') => void;
    onTimingMode?: (mode: string) => void;
    loadModes?: (modes: readonly string[]) => Promise<void> | void;
}

export function createGraphicsController({
    select,
    options,
    left,
    right,
    splitControl,
    storage,
    events,
    onActivity,
    onInteraction,
    onAudioMode,
    onTimingMode,
    onChooseNative,
    onChooseClassic,
    loadModes,
}: GraphicsOptions) {
    const selects = { left, right };
    let desiredPair = readSplitPair(storage.get('splitPair'));
    let currentMode = select.value;
    let renderer: ReturnType<typeof createRenderer> | undefined;
    let disposed = false,
        revision = 0;
    const readyWaiters = new Set<() => void>();
    function resolveReady() {
        for (const resolve of readyWaiters) resolve();
        readyWaiters.clear();
    }
    for (const option of select.options) {
        if (option.value !== 'split' && GRAPHICS_MODES.some((mode) => mode === option.value)) {
            for (const side of SPLIT_SIDES) selects[side].append(option.cloneNode(true));
        }
    }
    for (const side of SPLIT_SIDES) selects[side].value = desiredPair[side];

    function applySplitPair() {
        if (!renderer || disposed) return;
        renderer.setSplitModes(desiredPair.left, desiredPair.right);
        const pair = renderer.splitModes;
        for (const side of SPLIT_SIDES) selects[side].value = pair[side];
        splitControl.setLabels(
            left.selectedOptions[0].textContent || '',
            right.selectedOptions[0].textContent || '',
        );
        onTimingMode?.(select.value === 'split' ? pair.left : renderer.graphicsMode);
        onAudioMode(select.value === 'split' ? pair.right : renderer.graphicsMode);
    }
    function updateVisibility() {
        const enabled = (renderer?.graphicsMode || select.value) === 'split';
        options.hidden = !enabled;
        splitControl.setEnabled(enabled);
    }
    function applyCurrent() {
        if (!renderer || disposed) return;
        const requested = select.value;
        renderer.setGraphicsMode(requested);
        currentMode = renderer.graphicsMode;
        select.value = currentMode;
        storage.set('graphics', currentMode);
        if (currentMode !== requested) onChooseClassic?.(currentMode);
        updateVisibility();
        applySplitPair();
        resolveReady();
    }
    function requestSelection() {
        const version = ++revision;
        const modes = select.value === 'split' ? Object.values(desiredPair) : [select.value];
        const loading = loadModes?.(modes);
        // The displayed bank stays active until the requested artwork is ready.
        // The persisted desired pair remains independent of its effective fallback.
        if (renderer && select.value === 'split') {
            const pair = renderer.splitModes;
            left.value = pair.left;
            right.value = pair.right;
        }
        updateVisibility();
        if (!loading) {
            applyCurrent();
            return;
        }
        select.setAttribute('aria-busy', 'true');
        function completeSelection() {
            if (disposed || version !== revision) return;
            applyCurrent();
            select.removeAttribute('aria-busy');
        }
        void loading.then(completeSelection);
    }
    for (const side of SPLIT_SIDES) {
        function handleSplitSideChange() {
            onActivity();
            desiredPair = { ...desiredPair, [side]: selects[side].value };
            storage.set('splitPair', JSON.stringify(desiredPair));
            requestSelection();
            onInteraction();
        }
        events.on(selects[side], 'change', handleSplitSideChange);
    }
    function handleGraphicsChange() {
        if (select.value === 'amiga' || select.value === 'atari-st') {
            const mode = select.value;
            revision++;
            select.removeAttribute('aria-busy');
            select.value = renderer?.graphicsMode || currentMode;
            onChooseNative?.(mode);
            return;
        }
        onChooseClassic?.(select.value);
        onActivity();
        requestSelection();
        onInteraction();
    }
    events.on(select, 'change', handleGraphicsChange);
    updateVisibility();
    return {
        get desiredPair() {
            return { ...desiredPair };
        },
        attach(value: ReturnType<typeof createRenderer>) {
            renderer = value;
        },
        applySplitPair,
        updateVisibility,
        setUnavailable(mode: string) {
            if (disposed) return;
            for (const control of [select, left, right]) {
                for (const option of control.options)
                    if (option.value === mode) option.disabled = true;
            }
        },
        async loadCurrent() {
            if (disposed) return;
            const ready = new Promise<void>((resolve) => readyWaiters.add(resolve));
            requestSelection();
            await ready;
        },
        destroy() {
            disposed = true;
            revision++;
            resolveReady();
        },
    };
}
