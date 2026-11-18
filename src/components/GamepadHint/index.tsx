import { Button } from '../Button/index.tsx';
import './index.css';

export function GamepadHint() {
    return (
        <aside id="gamepad-hint" class="gamepad-hint" aria-label="Gamepad recommendation" hidden>
            <svg
                class="gamepad-hint__icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                stroke-width={1.7}
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="M7.5 6.5h9c2 0 3.2 1.6 3.8 4l1 5c.6 3-2 4-3.7 1.9L15 14.5H9l-2.6 2.9c-1.7 2.1-4.3 1.1-3.7-1.9l1-5c.6-2.4 1.8-4 3.8-4Z" />
                <path d="M7.5 9v4M5.5 11h4" />
                <circle cx={15.5} cy={10} r={0.65} fill="currentColor" stroke="none" />
                <circle cx={18} cy={12} r={0.65} fill="currentColor" stroke="none" />
            </svg>
            <p class="gamepad-hint__message" role="status" aria-live="polite">
                For the best experience, play with a gamepad.
            </p>
            <Button
                id="gamepad-hint-dismiss"
                type="button"
                variant="secondary"
                class="gamepad-hint__dismiss"
                aria-label="Dismiss gamepad recommendation"
            >
                <svg
                    class="gamepad-hint__close-icon"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                    fill="none"
                    stroke="currentColor"
                    stroke-width={1.8}
                    stroke-linecap="round"
                >
                    <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
            </Button>
        </aside>
    );
}
