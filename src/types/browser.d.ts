interface Window {
    webkitAudioContext?: typeof AudioContext;
}
interface Document {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
}
interface Element {
    webkitMatchesSelector?: (selectors: string) => boolean;
}

declare module '*.css';
