import './index.css';

export function Notifications() {
    return (
        <p
            id="notifications"
            class="notifications"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            hidden
        />
    );
}
