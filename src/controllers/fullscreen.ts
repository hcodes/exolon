interface FullscreenBinding {
    owner: object;
    fallback: boolean;
}
type FullscreenContainer = HTMLElement & { __reexFullscreen?: FullscreenBinding };

// Standalone equivalent of the project's native/window FullScreenController behavior.
export function createFullscreenControl(
    element: HTMLElement,
    button: HTMLButtonElement,
    {
        onChange = () => {},
        onEscape = () => {},
    }: { onChange?: (active: boolean) => void; onEscape?: () => void } = {},
) {
    const doc = element.ownerDocument;
    const navigator = doc.defaultView?.navigator;
    button.hidden = Boolean(
        navigator &&
        (/\b(?:iPhone|iPad|iPod)\b/i.test(navigator.userAgent) ||
            (/\bMacintosh\b/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)),
    );
    // The container survives replacement of the landing and platform applications.
    const target = (
        element.parentElement?.id === 'app' ? element.parentElement : element
    ) as FullscreenContainer;
    const token = {};
    const shared =
        target !== element
            ? (target.__reexFullscreen ||= { owner: token, fallback: false })
            : undefined;
    if (shared) shared.owner = token;
    const current = () => !shared || shared.owner === token;
    let fallback = shared?.fallback || false,
        busy = false,
        disposed = false,
        version = 0,
        lastNative = false,
        previous = false,
        requestedExit = false;
    const ownsNative = () =>
        current() && (doc.fullscreenElement === target || doc.webkitFullscreenElement === target);
    const editsTvName = () =>
        Boolean(
            element.classList.contains?.('game-app_tv') &&
            doc.activeElement?.tagName === 'INPUT' &&
            (doc.activeElement as HTMLInputElement).type === 'text',
        );
    function update() {
        if (ownsNative()) lastNative = true;
        const active = !disposed && (fallback || ownsNative());
        element.classList.toggle('game-app_fullscreen', active);
        if (current()) {
            if (shared) shared.fallback = fallback;
            doc.documentElement.classList.toggle('page_fullscreen', active);
        }
        const label = active ? 'Exit fullscreen' : 'Fullscreen';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = busy || disposed;
        if (active !== previous) {
            previous = active;
            onChange(active);
        }
    }
    async function exitNative() {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (ownsNative() && typeof exit === 'function') {
            requestedExit = true;
            try {
                await exit.call(doc);
            } catch {
                requestedExit = false; /* Browser Escape remains available if exit is denied. */
            }
        }
    }
    async function leave() {
        version++;
        fallback = false;
        update();
        await exitNative();
        update();
    }
    async function toggle() {
        if (busy || disposed) return;
        busy = true;
        try {
            if (fallback || ownsNative()) {
                await leave();
                return;
            }
            const revision = ++version;
            lastNative = false;
            requestedExit = false;
            fallback = true;
            update();
            // Legacy prefixed void requests cannot be safely cancelled; use window mode there.
            const request = target.requestFullscreen;
            if (typeof request === 'function' && doc.fullscreenEnabled !== false) {
                try {
                    await request.call(target);
                } catch {
                    /* Keep the expanded window mode. */
                }
            }
            if (disposed || revision !== version) {
                fallback = false;
                await exitNative();
            } else if (ownsNative()) fallback = false;
        } finally {
            busy = false;
            update();
        }
    }
    function nativeChange() {
        const native = ownsNative();
        if (lastNative && !native) {
            version++;
            if (!requestedExit && !disposed && !editsTvName()) onEscape();
            requestedExit = false;
        }
        lastNative = native;
        fallback = false;
        update();
    }
    function escape(event: KeyboardEvent) {
        if (
            event.defaultPrevented ||
            event.code !== 'Escape' ||
            !previous ||
            event.isComposing ||
            editsTvName() ||
            doc.querySelector('.modal:not([hidden])')
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        void leave();
    }
    const click = () => void toggle();
    button.addEventListener('click', click);
    doc.addEventListener('fullscreenchange', nativeChange);
    doc.addEventListener('webkitfullscreenchange', nativeChange);
    doc.addEventListener('keydown', escape, { capture: true });
    update();
    return {
        toggle,
        destroy() {
            disposed = true;
            version++;
            if (shared) {
                // The next app binds synchronously during the same Preact commit.
                // A final unmount has no successor and releases the browser state.
                function releaseUnclaimedFullscreen() {
                    if (!current()) return;
                    fallback = false;
                    void exitNative();
                    update();
                }
                void Promise.resolve().then(releaseUnclaimedFullscreen);
            } else {
                fallback = false;
                void exitNative();
                update();
            }
            button.removeEventListener('click', click);
            doc.removeEventListener('fullscreenchange', nativeChange);
            doc.removeEventListener('webkitfullscreenchange', nativeChange);
            doc.removeEventListener('keydown', escape, { capture: true });
        },
    };
}
