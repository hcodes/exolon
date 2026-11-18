export type TvKey =
    'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Back' | 'Pause';

export function isTvBrowser(userAgent: string): boolean {
    if (
        /smart[ -]?tv|web[o0]s|hbbtv|netcast|googletv|vidaa|(?:android[^)]*\b(?:tv|bravia|aft\w*))|(?:tizen[^)]*\btv\b)/i.test(
            userAgent,
        )
    )
        return true;
    // Older Hisense TV browsers can omit SmartTV. Hisense Android phones and
    // tablets share the brand, so they still need an explicit TV marker.
    return /hisense/i.test(userAgent) && !/android|mobile|iphone|ipad/i.test(userAgent);
}

export function tvKey(
    event: {
        code?: string;
        key?: string;
        keyCode?: number;
        which?: number;
    },
    numberButtons = true,
): TvKey | null {
    const numeric: Record<number, TvKey> = {
        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',
        13: 'Enter',
        461: 'Back',
        10009: 'Back',
        27: 'Back',
        19: 'Pause',
        415: 'Pause',
        10252: 'Pause',
    };
    const names: Record<string, TvKey> = {
        ArrowLeft: 'ArrowLeft',
        ArrowRight: 'ArrowRight',
        ArrowUp: 'ArrowUp',
        ArrowDown: 'ArrowDown',
        Enter: 'Enter',
        NumpadEnter: 'Enter',
        Escape: 'Back',
        BrowserBack: 'Back',
        GoBack: 'Back',
        Back: 'Back',
        Pause: 'Pause',
        MediaPlay: 'Pause',
        MediaPause: 'Pause',
        MediaPlayPause: 'Pause',
    };
    const digits: Record<string, TvKey> = {
        '2': 'ArrowUp',
        '4': 'ArrowLeft',
        '5': 'Enter',
        '6': 'ArrowRight',
        '8': 'ArrowDown',
    };
    const digitCodes: Record<number, TvKey> = {
        50: 'ArrowUp',
        52: 'ArrowLeft',
        53: 'Enter',
        54: 'ArrowRight',
        56: 'ArrowDown',
        98: 'ArrowUp',
        100: 'ArrowLeft',
        101: 'Enter',
        102: 'ArrowRight',
        104: 'ArrowDown',
    };
    return (
        numeric[event.keyCode || event.which || 0] ||
        names[event.code || ''] ||
        names[event.key || ''] ||
        (numberButtons &&
            (digitCodes[event.keyCode || event.which || 0] ||
                digits[(event.code || '').replace(/^(?:Digit|Numpad)/, '')] ||
                digits[event.key || ''])) ||
        null
    );
}
