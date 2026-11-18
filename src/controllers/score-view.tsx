import { render } from 'preact';
import { ScoreRows } from '../components/ScoreRows/index.tsx';
import type { HighScoreRow, AttractPage } from '../model/high-scores.ts';
import { gameElement } from '../utils/dom.ts';

export function createScoreView(document: Document) {
    const byId = <K extends string>(id: K) => gameElement(document, id),
        list = byId('score-list');
    return {
        showPage(page: AttractPage) {
            const scores = page === 'scores';
            byId('title-screen').classList.toggle('title-menu_scores', scores);
            byId('title-intro').hidden = scores;
            byId('high-scores').hidden = !scores;
            byId('show-scores').hidden = scores;
            byId('back-title').hidden = !scores;
        },
        render({
            lastScore,
            bestScore,
            rows,
        }: {
            lastScore: number;
            bestScore: number;
            rows: HighScoreRow[];
        }) {
            render(String(lastScore).padStart(6, '0'), byId('scores-last'));
            render(String(bestScore).padStart(6, '0'), byId('scores-best'));
            render(<ScoreRows rows={rows} />, list);
        },
        scroll(offset: number) {
            const height = (list.firstElementChild as HTMLElement | null)?.offsetHeight || 16;
            list.style.transform = `translateY(${-offset * height}px)`;
        },
        destroy() {
            render(null, list);
            render(null, byId('scores-last'));
            render(null, byId('scores-best'));
        },
    };
}
