import { SettingsToggle } from '../SettingsToggle/index.tsx';
import { FpsCounter } from '../FpsCounter/index.tsx';
import './index.css';
export function GameViewport() {
    return (
        <section class="game-viewport" aria-label="Exolon game">
            <div class="game-viewport__display">
                <canvas
                    id="game"
                    class="game-viewport__canvas"
                    width={256}
                    height={192}
                    tabIndex={0}
                    aria-label="Game screen. O and P: move, Q: jump, A: crouch, M: fire."
                ></canvas>
                <FpsCounter />
                <button
                    id="split-divider"
                    class="game-viewport__split-divider"
                    type="button"
                    role="slider"
                    aria-label="Boundary between ZX Spectrum and Remastered"
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={50}
                    hidden
                >
                    <span class="game-viewport__split-grip" aria-hidden="true">
                        <svg
                            class="game-viewport__split-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="m8 8-4 4 4 4m8-8 4 4-4 4M12 5v14" />
                        </svg>
                    </span>
                </button>
            </div>
            <SettingsToggle />
        </section>
    );
}
