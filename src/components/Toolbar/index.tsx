import type { ComponentChildren } from 'preact';
import { PauseButton } from '../PauseButton/index.tsx';
import type { PauseButtonVariant } from '../PauseButton/index.tsx';
import { Button } from '../Button/index.tsx';
import './index.css';

export function Toolbar({
    pauseVariant,
    children,
}: {
    pauseVariant?: PauseButtonVariant;
    children?: ComponentChildren;
}) {
    return (
        <div class="toolbar" role="group" aria-label="Navigation">
            {children}
            <span id="mission-status" class="toolbar__status" role="status">
                PREPARING TO LAND
            </span>
            <div class="toolbar__actions">
                <PauseButton variant={pauseVariant} />
                <Button id="restart" variant="secondary" disabled hidden>
                    Restart
                </Button>
                <Button id="menu" variant="secondary" disabled hidden>
                    Menu
                </Button>
            </div>
        </div>
    );
}
