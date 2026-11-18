import { Input } from '../Input/index.tsx';
import { Button } from '../Button/index.tsx';
import './index.css';

export function SoundControls() {
    return (
        <div class="sound-controls">
            <span class="sound-controls__sound-actions">
                <Button
                    id="sound"
                    variant="secondary"
                    class="sound-controls__sound"
                    aria-pressed="false"
                    aria-label="Mute"
                    title="Mute"
                >
                    <svg
                        class="sound-controls__icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                    >
                        <path d="M11 5 6 9H3v6h3l5 4Z" />
                        <path
                            class="sound-controls__waves"
                            d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"
                        />
                        <path class="sound-controls__muted" d="m16 9 6 6m0-6-6 6" />
                    </svg>
                </Button>
            </span>
            <label class="sound-controls__volume">
                {'Volume '}
                <Input
                    id="volume"
                    class="sound-controls__slider"
                    aria-label="Volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value="0.35"
                />
            </label>
        </div>
    );
}
