export interface NormalizedPointerEvent {
    type: string;
    target: EventTarget | null;
    isTrusted: boolean;
    pointerId: number;
    pointerType: string;
    button: number;
    clientX: number;
    clientY: number;
    preventDefault(): void;
    stopPropagation(): void;
}
export type ScopedPointerEvent = PointerEvent | NormalizedPointerEvent;
type PointerEventName =
    'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture';
export type ScopedEvent<K extends string> = K extends PointerEventName
    ? ScopedPointerEvent
    : K extends 'click'
      ? MouseEvent & { pointerType?: string }
      : K extends keyof WindowEventMap
        ? WindowEventMap[K]
        : Event;
export type EventScope = ReturnType<typeof createEventScope>;

// Own listeners explicitly: older Safari has neither AbortController nor
// addEventListener({signal}). Touch callbacks retain the original trusted event.
export function createEventScope(
    view: (Window & { PointerEvent?: typeof PointerEvent }) | null | undefined,
) {
    const cleanups: (() => void)[] = [];
    const legacy = Boolean(view && !view.PointerEvent && 'ontouchstart' in view);
    let lastTouch = -Infinity,
        passive = false;
    try {
        const noop = () => {},
            options = Object.defineProperty({}, 'passive', {
                get() {
                    passive = true;
                    return false;
                },
            });
        view?.addEventListener('exolon-options', noop, options);
        view?.removeEventListener('exolon-options', noop, options);
    } catch {
        /* Boolean listener options work on older engines. */
    }
    function listen(
        target: EventTarget | null | undefined,
        type: string,
        callback: EventListener,
        capture = false,
    ) {
        if (!target?.addEventListener) {
            const query = target as MediaQueryList | null | undefined;
            if (type === 'change' && query?.addListener && query.removeListener) {
                query.addListener(callback);
                cleanups.push(() => query.removeListener(callback));
            }
            return;
        }
        const options = passive ? { capture: Boolean(capture), passive: false } : Boolean(capture);
        target.addEventListener(type, callback, options);
        cleanups.push(() => target.removeEventListener(type, callback, Boolean(capture)));
    }
    function normalized(
        event: TouchEvent | MouseEvent,
        type: string,
        point: Touch | MouseEvent,
        touch: boolean,
    ): NormalizedPointerEvent {
        return {
            type,
            target: touch ? point.target : event.target,
            isTrusted: event.isTrusted,
            pointerId: touch ? (point as Touch).identifier + 2 : 1,
            pointerType: touch ? 'touch' : 'mouse',
            button: touch ? 0 : (event as MouseEvent).button,
            clientX: point.clientX,
            clientY: point.clientY,
            preventDefault: () => event.preventDefault(),
            stopPropagation: () => event.stopPropagation(),
        };
    }
    return {
        on<K extends string>(
            target: EventTarget | null | undefined,
            type: K,
            callback: (event: ScopedEvent<K>) => void,
            capture = false,
        ) {
            const touchType = (
                {
                    pointerdown: 'touchstart',
                    pointermove: 'touchmove',
                    pointerup: 'touchend',
                    pointercancel: 'touchcancel',
                } as Record<string, string>
            )[type];
            if (!legacy || !touchType) {
                listen(target, type, callback as EventListener, capture);
                return;
            }
            const receiver = type === 'pointermove' ? view : target;
            listen(
                receiver,
                touchType,
                (raw) => {
                    const event = raw as TouchEvent;
                    lastTouch = Date.now();
                    for (let i = 0; i < event.changedTouches.length; i++)
                        callback(
                            normalized(
                                event,
                                type,
                                event.changedTouches[i],
                                true,
                            ) as ScopedEvent<K>,
                        );
                },
                capture,
            );
            const mouseType = (
                {
                    pointerdown: 'mousedown',
                    pointermove: 'mousemove',
                    pointerup: 'mouseup',
                } as Record<string, string>
            )[type];
            if (mouseType)
                listen(
                    receiver,
                    mouseType,
                    (raw) => {
                        const event = raw as MouseEvent;
                        if (Date.now() - lastTouch > 800)
                            callback(normalized(event, type, event, false) as ScopedEvent<K>);
                    },
                    capture,
                );
        },
        destroy() {
            for (const cleanup of cleanups.splice(0)) cleanup();
        },
    };
}
