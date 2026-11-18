import type { GameState } from '../types/game.ts';
import type { Graphics, SceneRenderer } from '../types/graphics.ts';
// Independent high-resolution presentation. Simulation and original bitmaps stay untouched.
import { createRemasteredSprites } from './remastered-sprites.ts';
import { createRemasteredLayerCache } from './remastered-cache.ts';
import {
    drawRemasteredScene,
    drawRemasteredForeground,
    drawRemasteredMenu,
} from './remastered-scene.ts';

export function createRemasteredRenderer(
    canvas: HTMLCanvasElement,
    graphics: Graphics,
    scale: 2 | 4 = 4,
): SceneRenderer {
    const c = canvas.getContext('2d', { alpha: false })!,
        sprites = createRemasteredSprites(graphics),
        scenery = createRemasteredLayerCache(canvas.ownerDocument, scale);
    function frame(draw: () => void) {
        if (canvas.width !== 256 * scale || canvas.height !== 192 * scale) {
            canvas.width = 256 * scale;
            canvas.height = 192 * scale;
        }
        c.setTransform(scale, 0, 0, scale, 0, 0);
        c.clearRect(0, 0, 256, 192);
        c.save();
        try {
            draw();
        } finally {
            c.restore();
            c.setTransform(1, 0, 0, 1, 0, 0);
        }
    }
    function hud(state: GameState) {
        const fill = c.createLinearGradient(0, 176, 0, 192);
        fill.addColorStop(0, '#162d43');
        fill.addColorStop(1, '#060e1b');
        c.fillStyle = fill;
        c.fillRect(0, 176, 256, 16);
        c.strokeStyle = '#3d687b';
        c.lineWidth = 0.35;
        c.beginPath();
        c.moveTo(0, 176.2);
        c.lineTo(256, 176.2);
        c.stroke();
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        for (const [label, value, x, color] of <[string, string | number, number, string][]>[
            ['AMMO', state.ammo, 5, '#b9f2ff'],
            ['ROCKETS', state.grenades, 47, '#ffbf80'],
            ['SCORE', String(state.score).padStart(6, '0'), 94, '#e0e8ff'],
            ['LIVES', state.lives, 173, '#b6f698'],
            ['ZONE', String(state.screenIndex + 1).padStart(3, '0'), 215, '#b6f698'],
        ]) {
            c.fillStyle = '#8aa6bb';
            c.font = '3.5px ui-monospace,monospace';
            c.fillText(label, x, 181.5);
            c.fillStyle = color;
            c.font = 'bold 6.5px ui-monospace,monospace';
            c.fillText(String(value).padStart(label === 'LIVES' ? 1 : 2, '0'), x, 189.5);
        }
    }
    return {
        observe(state, events) {
            sprites.observe(state, events);
        },
        render(
            state,
            _time = 0,
            fraction = 0,
            { paused = false, nameEntry = false, playerName = null } = {},
        ) {
            const part = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
            const visualTime = ((state.tick + part) * 1000) / 30;
            frame(() => {
                if (state.status === 'won' || nameEntry) {
                    drawRemasteredMenu(c, graphics, visualTime, {
                        kind: 'hallOfFame',
                        state,
                        playerName: playerName ?? '',
                        bestScore: state.score,
                    });
                    return;
                }
                if (state.status === 'bonus') {
                    drawRemasteredMenu(c, graphics, visualTime, {
                        kind: 'bonus',
                        state,
                        bonus: state.bonus!,
                    });
                    return;
                }
                c.save();
                c.beginPath();
                c.rect(0, 0, 256, 176);
                c.clip();
                drawRemasteredScene(c, state, graphics, visualTime, scenery);
                sprites.draw(c, state, visualTime, part);
                drawRemasteredForeground(c, state, visualTime, scenery);
                c.restore();
                hud(state);
                if (state.status === 'over')
                    drawRemasteredMenu(c, graphics, visualTime, { kind: 'gameOver', state });
                else if (paused) {
                    c.fillStyle = '#081224db';
                    c.fillRect(102, 76, 52, 16);
                    c.strokeStyle = '#77d9e6';
                    c.lineWidth = 0.4;
                    c.strokeRect(102, 76, 52, 16);
                    c.font = 'bold 7px ui-monospace,monospace';
                    c.fillStyle = '#e8fbff';
                    c.textAlign = 'center';
                    c.fillText('PAUSED', 128, 86.5);
                }
            });
        },
        renderTitle(time, options) {
            frame(() =>
                drawRemasteredMenu(c, graphics, time, {
                    ...options,
                    kind: options?.scores ? 'scores' : 'title',
                }),
            );
        },
        reset() {
            sprites.reset();
            scenery.reset();
        },
    };
}
