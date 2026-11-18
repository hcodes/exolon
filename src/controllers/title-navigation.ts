import type { EventScope } from '../lib/events.ts';
import type { AttractPage } from '../model/high-scores.ts';
import type { createScoreAttract } from '../model/high-scores.ts';
import type { createScoreController } from './scores.ts';
import type { createScoreView } from './score-view.tsx';
import type { createControlMenuController } from './control-menu.ts';
import type { createApplicationSession } from './application-session.ts';
import type { createRenderer } from '../view/renderer.ts';
import { normalizePlayerName } from '../model/high-scores.ts';
import { gameElement } from '../utils/dom.ts';

interface TitleNavigationOptions {
    document: Document;
    gestures: EventScope;
    attract: ReturnType<typeof createScoreAttract>;
    scores: ReturnType<typeof createScoreController>;
    scoreView: ReturnType<typeof createScoreView>;
    controlMenu: ReturnType<typeof createControlMenuController>;
    getSession(): ReturnType<typeof createApplicationSession>;
    getRenderer(): ReturnType<typeof createRenderer>;
}

export function createTitleNavigation({
    document,
    gestures,
    attract,
    scores,
    scoreView,
    controlMenu,
    getSession,
    getRenderer,
}: TitleNavigationOptions) {
    const byId = <K extends string>(id: K) => gameElement(document, id);
    const canvas = byId('game'),
        settingsPanel = byId('settings-panel'),
        homePanel = byId('home-panel'),
        nameForm = byId('name-entry'),
        nameInput = byId('player-name'),
        status = byId('mission-status');
    let menuPage: AttractPage = 'title';
    let scoreRecords = scores.rows;
    function updateScores() {
        scoreRecords = scores.rows;
        scoreView.render({
            lastScore: scores.lastScore,
            bestScore: scores.bestScore,
            rows: scoreRecords,
        });
    }

    function showMenuPage(page: AttractPage) {
        if (page === 'menu' && !controlMenu.available) {
            attract.reset();
            page = 'title';
        }
        if (page !== 'menu') controlMenu.cancel();
        menuPage = page;
        canvas.dataset.menu = page;
        scoreView.showPage(page);
        if (page === 'scores') updateScores();
    }

    gestures.on(nameInput, 'input', () => nameInput.setCustomValidity(''));
    function submitPlayerName(event: Event) {
        event.preventDefault();
        if (nameForm.hidden || !['won', 'over'].includes(getSession().mode)) return;
        const candidate = nameInput.value.trim();
        const renderer = getRenderer();
        const international =
            renderer.graphicsMode === 'remastered' ||
            (renderer.graphicsMode === 'split' &&
                Object.values(renderer.splitModes).includes('remastered'));
        const valid = international
            ? normalizePlayerName(candidate, '') ===
              (candidate.normalize?.('NFC') ?? candidate).toUpperCase()
            : /^[A-Za-z0-9 .!?'-]{1,8}$/.test(candidate);
        if (!candidate || !valid) {
            nameInput.setCustomValidity(
                international
                    ? 'Enter up to 8 letters or digits.'
                    : 'Enter up to 8 Latin letters or digits.',
            );
            nameInput.focus({ preventScroll: true });
            nameInput.select();
            return;
        }
        const stored = scores.submit(candidate, getSession().state);
        getSession().showTitle();
        openScores();
        if (!stored) status.textContent = 'SCORES AVAILABLE IN THIS TAB / LOCALSTORAGE UNAVAILABLE';
    }
    gestures.on(nameForm, 'submit', submitPlayerName);

    function openScores() {
        controlMenu.cancel();
        attract.showScores();
        showMenuPage('scores');
        document.querySelector<HTMLElement>('.high-scores__window')!.focus({ preventScroll: true });
    }
    function closeScores() {
        attract.reset();
        showMenuPage('title');
        byId('show-scores').focus({ preventScroll: true });
    }
    gestures.on(byId('show-scores'), 'click', openScores);
    gestures.on(byId('back-title'), 'click', closeScores);

    function frame(now: number, renderer: ReturnType<typeof createRenderer>) {
        const menu = attract.frame(
            now,
            getSession().mode === 'title' &&
                !document.hidden &&
                Boolean(settingsPanel.hidden) &&
                Boolean(homePanel.hidden) &&
                !controlMenu.defining,
            controlMenu.available,
        );
        if (getSession().mode === 'title') {
            if (menu.page !== menuPage) showMenuPage(menu.page);
            if (menu.page === 'scores') {
                scoreView.scroll(menu.offset);
            }
            renderer.renderTitle(now, {
                scores: menu.page === 'scores',
                menu: menu.page === 'menu',
                rows: scoreRecords,
                offset: menu.offset,
                controls: controlMenu.snapshot,
            });
            return true;
        }
        return false;
    }
    return {
        get page() {
            return menuPage;
        },
        showPage: showMenuPage,
        openScores,
        closeScores,
        frame,
        destroy: () => scoreView.destroy(),
    };
}
