import { Button } from '../Button/index.tsx';
import './index.css';

export function FullscreenButton() {
    return (
        <Button
            id="fullscreen"
            variant="secondary"
            class="fullscreen-button"
            aria-pressed="false"
            aria-label="Fullscreen"
            title="Fullscreen"
        >
            <svg
                class="fullscreen-button__icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
            >
                <path class="fullscreen-button__enter" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
                <path class="fullscreen-button__exit" d="M4 9h5V4m6 0v5h5m0 6h-5v5M9 20v-5H4" />
            </svg>
        </Button>
    );
}
