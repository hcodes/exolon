import { HighScores } from '../HighScores/index.tsx';
import { Button } from '../Button/index.tsx';
import './index.css';
export function TitleMenu() {
    return (
        <div class="title-menu" id="title-screen">
            <div class="title-menu__intro" id="title-intro">
                <span class="title-menu__eyebrow">RAFFAELE CECCO · HEWSON · 1987</span>
                <h1 class="title-menu__heading">EXOLON</h1>
                <p class="title-menu__tagline">ONE MAN. ONE MISSION. NO RETREAT.</p>
                <p class="title-menu__campaign">
                    5 WORLDS <span class="title-menu__separator">•</span> 125 SCREENS{' '}
                    <span class="title-menu__separator">•</span> ORIGINAL MAPS
                </p>
            </div>
            <HighScores />
            <div class="title-menu__actions">
                <Button variant="primary" id="new-game" class="title-menu__action" disabled>
                    Loading…
                </Button>
                <Button variant="secondary" id="show-controls" class="title-menu__action" disabled>
                    Controls
                </Button>
                <Button variant="secondary" id="show-scores" class="title-menu__action" disabled>
                    Scores
                </Button>
                <Button variant="secondary" id="back-title" class="title-menu__action" hidden>
                    Back
                </Button>
            </div>
            <p class="title-menu__music-status" id="music-status" hidden></p>
            <p class="title-menu__controls">
                O / P — move · Q — jump · A — crouch · M — fire
                <br />
                Tap to shoot. Hold to launch a rocket.
            </p>
        </div>
    );
}
