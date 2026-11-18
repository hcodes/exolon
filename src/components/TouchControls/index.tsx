import { Button } from '../Button/index.tsx';
import './index.css';

export function TouchControls() {
    return (
        <div class="touch-controls" id="touch" aria-label="Touch controls">
            <div
                class="touch-controls__stick"
                data-stick
                role="group"
                aria-label="Movement stick: up to jump, down to crouch"
            >
                <Button
                    variant="secondary"
                    class="touch-controls__button touch-controls__button_up"
                    data-action="jump"
                    aria-label="Jump"
                >
                    <span aria-hidden="true">↑</span>
                </Button>
                <Button
                    variant="secondary"
                    class="touch-controls__button touch-controls__button_left"
                    data-action="left"
                    aria-label="Move left"
                >
                    <span aria-hidden="true">←</span>
                </Button>
                <Button
                    variant="secondary"
                    class="touch-controls__button touch-controls__button_right"
                    data-action="right"
                    aria-label="Move right"
                >
                    <span aria-hidden="true">→</span>
                </Button>
                <Button
                    variant="secondary"
                    class="touch-controls__button touch-controls__button_down"
                    data-action="duck"
                    aria-label="Crouch"
                >
                    <span aria-hidden="true">↓</span>
                </Button>
                <span class="touch-controls__thumb" data-stick-thumb aria-hidden="true" />
            </div>
            <div class="touch-controls__actions">
                <Button
                    variant="secondary"
                    data-action="fire"
                    class="touch-controls__button touch-controls__button_fire"
                    aria-label="Fire bullets"
                >
                    <svg class="touch-controls__icon" viewBox="0 0 32 32" aria-hidden="true">
                        <path d="M8 27V10a4 4 0 0 1 8 0v17Zm12 0V14a3 3 0 0 1 6 0v13ZM8 21h8m4 0h6" />
                    </svg>
                    <span class="touch-controls__label">FIRE</span>
                </Button>
                <Button
                    variant="secondary"
                    data-action="rocket"
                    class="touch-controls__button touch-controls__button_rocket"
                    aria-label="Launch rocket"
                >
                    <svg class="touch-controls__icon" viewBox="0 0 32 32" aria-hidden="true">
                        <path d="m16 3-5 8v12h10V11Zm-5 12-5 8h5m10-8 5 8h-5m-8 4 3 3 3-3M11 12h10" />
                    </svg>
                    <span class="touch-controls__label">ROCKETS</span>
                </Button>
            </div>
        </div>
    );
}
