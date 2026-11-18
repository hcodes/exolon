import { isTvBrowser } from './tv.ts';

export function isMobileBrowser(userAgent: string, maxTouchPoints = 0): boolean {
    if (isTvBrowser(userAgent) || /OculusBrowser|Quest|\b(?:Mobile)?VR\b/i.test(userAgent))
        return false;
    return (
        /\b(?:Mobile|Android|iOS|iPhone|iPad|iPod)\b/i.test(userAgent) ||
        (/\bMacintosh\b/i.test(userAgent) && maxTouchPoints > 1)
    );
}
