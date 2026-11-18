import { Button } from '../Button/index.tsx';
import './index.css';

export function HomeButton() {
    return (
        <Button
            id="home"
            type="button"
            variant="secondary"
            class="home-button"
            aria-label="Home"
            title="Home"
            aria-expanded="false"
            aria-controls="home-panel"
            aria-haspopup="dialog"
        >
            <svg
                class="home-button__icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
            >
                <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
            </svg>
        </Button>
    );
}
