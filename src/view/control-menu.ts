import type { ControlMenuSnapshot } from '../model/control-menu.ts';
import {
    createControlMenu,
    controlPlatform,
    controlEntries,
    CONTROL_ACTIONS,
} from '../model/control-menu.ts';
const DEFAULTS = createControlMenu().snapshot;
interface MenuPainter {
    clear(): void;
    text(value: string, x: number, row: number): void;
    highlight(row: number, width: number): void;
}

// Reuse each platform's recovered glyphs/palette, rather than HTML overlays.
export function drawControlMenu(
    mode: string,
    snapshot: ControlMenuSnapshot | undefined,
    painter: MenuPainter,
) {
    const state = snapshot || DEFAULTS,
        platform = controlPlatform(mode);
    if (state.definition) {
        painter.clear();
        painter.text(platform === 'c64' ? 'SELECT KEYS FOR....' : 'SELECT KEY FOR....', 7, 6);
        CONTROL_ACTIONS.forEach((action, index) => {
            painter.text(action.toUpperCase(), 7, 9 + index * 2);
            painter.text(
                state.definition!.labels[index] || (state.definition!.step === index ? '?' : ''),
                15,
                9 + index * 2,
            );
        });
        return;
    }
    if (platform !== 'cpc')
        painter.highlight(
            15 + state.profiles[platform].device * 2,
            platform === 'sharp-mz800' ? 8 : 14,
        );
    if (snapshot)
        painter.text(
            '>',
            7,
            controlEntries(platform)[Math.min(state.focus, controlEntries(platform).length - 1)]
                .row,
        );
}
