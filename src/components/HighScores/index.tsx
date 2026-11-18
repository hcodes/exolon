import './index.css';

export function HighScores() {
    return (
        <section class="high-scores" id="high-scores" aria-labelledby="scores-heading" hidden>
            <h2 id="scores-heading" class="high-scores__heading">
                EXOLON · HIGH SCORES
            </h2>
            <p class="high-scores__summary">
                Your score{' '}
                <strong class="high-scores__score" id="scores-last">
                    000000
                </strong>
                <strong class="high-scores__score" id="scores-best" hidden>
                    000000
                </strong>
            </p>
            <div class="high-scores__columns" aria-hidden="true">
                <span>PLAYER</span>
                <span>SCORE</span>
            </div>
            <div class="high-scores__window" tabIndex={0} aria-label="Leaderboard, 50 players">
                <ol class="high-scores__list" id="score-list"></ol>
            </div>
        </section>
    );
}
