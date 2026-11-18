interface LegacyKeyboardEvent {
    keyCode?: number;
    which?: number;
    location?: number;
    shiftKey?: boolean;
}

// Loaded only by the classic bundle, after language and Fetch polyfills.
export function legacyColor<T>(value: T): T | string {
    if (typeof value !== 'string') return value;
    const match = /^#([\da-f]{4}|[\da-f]{8})$/i.exec(value);
    if (!match) return value;
    const hex =
        match[1].length === 4
            ? match[1]
                  .split('')
                  .map((n) => n + n)
                  .join('')
            : match[1];
    return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${parseInt(hex.slice(6, 8), 16) / 255})`;
}

export function legacyKeyboardValue(event: LegacyKeyboardEvent, property: 'code' | 'key') {
    const number = event.keyCode || event.which || 0;
    const special: Record<number, string> = {
        8: 'Backspace',
        9: 'Tab',
        13: 'Enter',
        16: 'Shift',
        17: 'Control',
        18: 'Alt',
        19: 'Pause',
        20: 'CapsLock',
        27: 'Escape',
        32: 'Space',
        33: 'PageUp',
        34: 'PageDown',
        35: 'End',
        36: 'Home',
        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',
        46: 'Delete',
        91: 'Meta',
        93: 'Meta',
    };
    let code = special[number] || '';
    if (number >= 65 && number <= 90) code = 'Key' + String.fromCharCode(number);
    if (number >= 48 && number <= 57) code = 'Digit' + String.fromCharCode(number);
    if (property === 'code')
        return ['Shift', 'Control', 'Alt', 'Meta'].includes(code)
            ? code + (event.location === 2 ? 'Right' : 'Left')
            : code;
    if (code === 'Space') return ' ';
    if (code.startsWith('Key')) return event.shiftKey ? code.slice(3) : code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
}

export function installLegacyRuntime(view: Window & typeof globalThis) {
    const doc = view.document,
        element = view.Element.prototype;
    const keyboard = view.KeyboardEvent?.prototype;
    if (keyboard)
        for (const property of ['code', 'key'] as const)
            if (!(property in keyboard))
                Object.defineProperty(keyboard, property, {
                    configurable: true,
                    get() {
                        return legacyKeyboardValue(this, property);
                    },
                });
    if (!element.matches && element.webkitMatchesSelector)
        element.matches = element.webkitMatchesSelector as Element['matches'];
    if (!element.closest)
        element.closest = function (selector: string) {
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- The DOM polyfill walks from its receiver through parent elements.
            let node: Element | null = this;
            while (node && node.nodeType === 1) {
                if (node.matches(selector)) return node;
                node = node.parentElement;
            }
            return null;
        };
    if (!element.append)
        element.append = function (...nodes) {
            for (const node of nodes)
                this.appendChild(typeof node === 'string' ? doc.createTextNode(node) : node);
        };
    if (!view.requestAnimationFrame) {
        view.requestAnimationFrame = (callback) =>
            view.setTimeout(
                () => callback(view.performance?.now ? view.performance.now() : Date.now()),
                1000 / 30,
            );
        view.cancelAnimationFrame = (id) => view.clearTimeout(id);
    }
    const canvas = view.CanvasRenderingContext2D?.prototype;
    if (canvas) {
        if (!canvas.ellipse)
            canvas.ellipse = function (x, y, rx, ry, rotation, start, end, anticlockwise = false) {
                this.save();
                this.translate(x, y);
                this.rotate(rotation);
                this.scale(rx, ry);
                this.arc(0, 0, 1, start, end, anticlockwise);
                this.restore();
            };
        // Safari 9 Canvas does not accept #RGBA / #RRGGBBAA paint strings.
        for (const name of ['fillStyle', 'strokeStyle', 'shadowColor']) {
            const descriptor = Object.getOwnPropertyDescriptor(canvas, name);
            if (descriptor?.set && descriptor.configurable) {
                const set = descriptor.set;
                Object.defineProperty(canvas, name, {
                    ...descriptor,
                    set(value) {
                        set.call(this, legacyColor(value));
                    },
                });
            }
        }
        const gradient = view.CanvasGradient?.prototype;
        if (gradient) {
            const add = gradient.addColorStop;
            gradient.addColorStop = function (offset, color) {
                return add.call(this, offset, legacyColor(color));
            };
        }
    }
}

// Geometry needs the Preact shell; primitive polyfills are installed earlier.
export function installLegacyLayout(view: Window) {
    const doc = view.document;
    const shellElement = doc.querySelector<HTMLElement>('.game-app');
    if (!shellElement) return () => {};
    const shell = shellElement;
    shell.classList.add('game-app_legacy');
    const gameElement = doc.getElementById('game');
    if (!gameElement) return () => {};
    const game = gameElement;
    const viewport = game.parentElement!,
        console = viewport.parentElement!,
        options = doc.querySelector<HTMLElement>('.game-footer__options')!,
        footer = doc.querySelector('footer')!;
    function layout() {
        if (
            shell.classList.contains('game-app_tv') ||
            shell.classList.contains('game-app_selecting')
        )
            return;
        const landscape = view.innerWidth > view.innerHeight;
        const fitHeight = landscape || !shell.classList.contains('game-app_touch');
        const displayRatio =
            game.dataset.game === 'amiga' || game.dataset.game === 'atari-st' ? 200 / 320 : 0.75;
        shell.classList.toggle('game-app_legacy-landscape', landscape);
        shell.style.padding = '8px';
        if (!fitHeight) {
            shell.style.height = 'auto';
            console.style.height = '';
            viewport.style.height = '';
            game.style.width = '100%';
            game.style.height = 'auto';
            options.style.maxHeight =
                Math.max(
                    64,
                    Math.min(320, view.innerHeight - viewport.clientWidth * displayRatio - 140),
                ) + 'px';
        } else {
            shell.style.height = view.innerHeight + 'px';
            options.style.maxHeight = '';
            const available = Math.max(
                80,
                view.innerHeight - footer.getBoundingClientRect().height - 18,
            );
            console.style.height = available + 'px';
            const displayHeight = Math.max(1, available - 2);
            viewport.style.height = displayHeight + 'px';
            const width = Math.min(viewport.clientWidth, displayHeight / displayRatio);
            game.style.width = width + 'px';
            game.style.height = width * displayRatio + 'px';
        }
    }
    // Late content and mode changes can alter the footer height.
    let timer: number | null = view.setInterval(layout, 250);
    let firstFrame: number | null = null;
    view.addEventListener('resize', layout, false);
    view.addEventListener('orientationchange', layout, false);
    function dispose() {
        if (timer !== null) view.clearInterval(timer);
        timer = null;
        if (firstFrame !== null) view.cancelAnimationFrame(firstFrame);
        firstFrame = null;
        view.removeEventListener('resize', layout, false);
        view.removeEventListener('orientationchange', layout, false);
        view.removeEventListener('pagehide', dispose, false);
    }
    view.addEventListener('pagehide', dispose, false);
    layout();
    // App/input setup adds touch classes after this mount hook. Re-measure before
    // its first painted frame rather than leaving controls clipped until the poll.
    if (typeof view.requestAnimationFrame === 'function')
        firstFrame = view.requestAnimationFrame(() => {
            firstFrame = null;
            if (timer !== null) layout();
        });
    return dispose;
}

if (typeof window !== 'undefined') installLegacyRuntime(window);
