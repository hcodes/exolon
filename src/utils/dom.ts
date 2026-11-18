export interface GameElements {
    game: HTMLCanvasElement;
    'gamepad-hint': HTMLElement;
    'gamepad-hint-dismiss': HTMLButtonElement;
    'settings-toggle': HTMLButtonElement;
    'settings-panel': HTMLDivElement;
    home: HTMLButtonElement;
    'home-panel': HTMLDivElement;
    platforms: HTMLButtonElement;
    touch: HTMLDivElement;
    'graphics-mode': HTMLSelectElement;
    monochrome: HTMLInputElement;
    'split-left': HTMLSelectElement;
    'split-right': HTMLSelectElement;
    'split-options': HTMLDivElement;
    'cheat-settings': HTMLElement;
    'name-entry': HTMLFormElement;
    'player-name': HTMLInputElement;
    volume: HTMLInputElement;
    pause: HTMLButtonElement;
    restart: HTMLButtonElement;
    sound: HTMLButtonElement;
    'new-game': HTMLButtonElement;
    'show-scores': HTMLButtonElement;
    'show-controls': HTMLButtonElement;
    'back-title': HTMLButtonElement;
    menu: HTMLButtonElement;
    'bonus-stop': HTMLButtonElement;
    'previous-screen': HTMLButtonElement;
    'next-screen': HTMLButtonElement;
    fullscreen: HTMLButtonElement;
    'split-divider': HTMLButtonElement;
    'save-name': HTMLButtonElement;
}
export function gameElement<K extends string>(
    document: Document,
    id: K,
): K extends keyof GameElements ? GameElements[K] : HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing game element: ${id}`);
    return element as K extends keyof GameElements ? GameElements[K] : HTMLElement;
}
