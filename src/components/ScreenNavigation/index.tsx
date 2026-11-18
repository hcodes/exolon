import { Button } from '../Button/index.tsx';
import './index.css';

export function ScreenNavigation({ vr = false }: { vr?: boolean }) {
    return (
        <nav
            id={vr ? 'vr-screen-navigation' : 'cheat-navigation'}
            class="screen-navigation"
            aria-label="Cheat screen selection"
            hidden
        >
            <Button
                id={vr ? 'vr-previous-screen' : 'previous-screen'}
                class="screen-navigation__button"
                variant="secondary"
                aria-label="Previous screen"
            >
                «
            </Button>
            <span
                id={vr ? 'vr-screen-number' : 'cheat-screen'}
                class="screen-navigation__number"
                role="status"
            >
                {vr ? '001 / 125' : 'SCREEN 001 / 125'}
            </span>
            <Button
                id={vr ? 'vr-next-screen' : 'next-screen'}
                class="screen-navigation__button"
                variant="secondary"
                aria-label="Next screen"
            >
                »
            </Button>
        </nav>
    );
}
