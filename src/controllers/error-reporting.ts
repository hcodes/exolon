import { showJSError } from 'show-js-error';
import './error-reporting.css';
import { createEventScope } from '../lib/events.ts';
import { reportJsError } from '../services/analytics.ts';

const ignoredErrors = [
    'Script error.',
    'nativeIframe',
    'ethereum',
    "Uncaught SyntaxError: Failed to execute 'evaluate' on 'Document': The string '' is not a valid XPath expression.",
    "Uncaught TypeError: Failed to execute 'evaluate' on 'Document': The result is not a node set, and therefore cannot be converted to the desired type.",
];

function errorText(error: unknown, property: 'message' | 'stack'): string {
    if (property === 'message' && typeof error === 'string') return error;
    if (typeof error !== 'object' || error === null) return '';
    const value = (error as Record<string, unknown>)[property];
    return typeof value === 'string' ? value : '';
}

/** Document-wide diagnostics survive game replacement and bfcache restores. */
export function installErrorReporting(view: Window): void {
    // Own capture so string/null rejections are safe and listeners have one lifecycle.
    showJSError.destruct();
    showJSError.setSettings({
        reportUrl: 'https://github.com/hcodes/reex/issues/new?title={title}&body={body}',
    });
    const debug = /(?:\?|&)debug=1(?:&|$)/.test(view.location.search);
    const events = createEventScope(view);

    function report(error: unknown, event?: ErrorEvent) {
        const message = event?.message || errorText(error, 'message') || 'no_message';
        if (ignoredErrors.indexOf(message) !== -1) return;
        const stack =
            errorText(error, 'stack') ||
            (event?.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'no_stack');
        reportJsError(message, stack);
        if (debug) showJSError.show({ title: 'JavaScript Error', message, stack });
    }
    function handleError(event: ErrorEvent) {
        report(event.error, event);
    }
    function handleRejection(event: PromiseRejectionEvent) {
        report(event.reason);
    }
    function handlePageHide(event: PageTransitionEvent) {
        if (event.persisted) return;
        events.destroy();
        showJSError.destruct();
    }
    events.on(view, 'error', handleError);
    events.on(view, 'unhandledrejection', handleRejection);
    events.on(view, 'pagehide', handlePageHide);
}
