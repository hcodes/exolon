import type { EventScope } from '../lib/events.ts';

interface ModalControlOptions {
    element: HTMLElement;
    events: EventScope;
    onCancel: () => void;
}

/** Shared by declarative Modal instances; callers own visibility and domain actions. */
export function createModalControl({ element, events, onCancel }: ModalControlOptions) {
    const document = element.ownerDocument;
    let previousFocus: HTMLElement | null = null;
    function focusable() {
        return [
            ...element.querySelectorAll<HTMLElement>(
                'button, input, select, textarea, a[href], [tabindex]',
            ),
        ].filter(
            (node) =>
                node.tabIndex >= 0 &&
                !node.hasAttribute('disabled') &&
                !node.closest('[hidden]') &&
                node.getClientRects().length > 0,
        );
    }
    function handleKey(event: KeyboardEvent) {
        if (element.hidden || event.defaultPrevented) return false;
        if (event.key === 'Escape' || event.code === 'Escape' || event.keyCode === 27) {
            event.preventDefault();
            if (!event.repeat) onCancel();
            return true;
        }
        if (event.key !== 'Tab' && event.keyCode !== 9) return false;
        const nodes = focusable();
        const first = nodes[0],
            last = nodes[nodes.length - 1];
        if (!first || !last) {
            event.preventDefault();
            element.focus();
        } else if (
            !element.contains(document.activeElement) ||
            document.activeElement === element
        ) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
        return true;
    }
    function handleDialogKeyDown(event: KeyboardEvent) {
        if (handleKey(event)) event.stopPropagation();
    }
    events.on(element, 'keydown', handleDialogKeyDown);
    function handleBackdropClick(event: MouseEvent) {
        if (!element.hidden && event.target === element) onCancel();
    }
    events.on(element, 'click', handleBackdropClick);
    for (const close of element.querySelectorAll('[data-modal-close]'))
        events.on(close, 'click', onCancel);
    return {
        open(trigger?: HTMLElement) {
            if (!element.hidden) return;
            previousFocus = trigger || (document.activeElement as HTMLElement | null);
            element.hidden = false;
            (focusable()[0] || element).focus({ preventScroll: true });
        },
        close(restoreFocus = true) {
            if (element.hidden) return;
            element.hidden = true;
            if (
                restoreFocus &&
                previousFocus &&
                typeof previousFocus.focus === 'function' &&
                document.documentElement.contains(previousFocus)
            )
                previousFocus.focus({ preventScroll: true });
            previousFocus = null;
        },
        handleKey,
    };
}
