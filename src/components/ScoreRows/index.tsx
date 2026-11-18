import classNames from 'classnames';
import './index.css';
import type { HighScoreRow } from '../../model/high-scores.ts';

export function ScoreRows({ rows }: { rows: HighScoreRow[] }) {
    return (
        <>
            {rows.map((record, index) => (
                <li
                    key={index}
                    class={classNames('score-row', { 'score-row_player': record.player })}
                >
                    <span>{record.name}</span>
                    <span class="score-row__score">{String(record.score).padStart(6, '0')}</span>
                </li>
            ))}
        </>
    );
}
