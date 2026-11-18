import { Button } from '../Button/index.tsx';
import './index.css';

export function SettingsToggle() {
    return (
        <div class="settings-toggle">
            <Button
                id="settings-toggle"
                type="button"
                variant="secondary"
                class="settings-toggle__button"
                aria-label="Settings"
                title="Show settings"
                aria-expanded="false"
                aria-controls="settings-panel"
                aria-haspopup="dialog"
            >
                <svg
                    class="settings-toggle__gear"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                    fill="none"
                    stroke="currentColor"
                    stroke-width={1.8}
                    stroke-linejoin="round"
                >
                    <path d="M9 3h6l.6 3L18 4.5l3 5.2-2.4 2.3 2.4 2.3-3 5.2-2.4-1.5-.6 3H9l-.6-3L6 19.5l-3-5.2L5.4 12 3 9.7l3-5.2L8.4 6Z" />
                    <circle cx={12} cy={12} r={3} />
                </svg>
            </Button>
        </div>
    );
}
