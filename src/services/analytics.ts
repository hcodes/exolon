import { hit, params } from 'lyam';
import { METRIKA_COUNTER_ID } from '../constants/analytics.ts';

let started = false;

/** Match checkdevice's visit-parameter hierarchy without creating another page view. */
export function reportJsError(message: string, stack: string): void {
    try {
        params(METRIKA_COUNTER_ID, { 'JS errors': { [message]: { [stack]: 1 } } });
    } catch {
        // A blocked transport must not produce another error to report.
    }
}

/** One page view per document; platform changes keep the same visit. */
export function startAnalytics(): void {
    if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
    started = true;
    try {
        hit(METRIKA_COUNTER_ID);
    } catch {
        // Optional analytics must not interrupt the game if its transport is blocked.
    }
}
