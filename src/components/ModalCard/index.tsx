import classNames from 'classnames';
import type { ComponentChildren } from 'preact';
import { Button } from '../Button/index.tsx';
import './index.css';

interface ModalCardProps {
    class?: string;
    heading: string;
    headingId: string;
    closeId?: string;
    closeLabel: string;
    compact?: boolean;
    formId?: string;
    actions: ComponentChildren;
    children: ComponentChildren;
}

/** Only the middle region scrolls; form actions stay inside their native form. */
export function ModalCard({
    class: className = '',
    heading,
    headingId,
    closeId,
    closeLabel,
    compact = false,
    formId,
    actions,
    children,
}: ModalCardProps) {
    const Card = formId ? 'form' : 'section';
    return (
        <Card
            id={formId}
            class={classNames('modal-card', { 'modal-card_compact': compact }, className)}
        >
            <header class="modal-card__header">
                <h2 id={headingId} class="modal-card__title">
                    {heading}
                </h2>
                <Button
                    id={closeId}
                    type="button"
                    variant="secondary"
                    class="modal-card__close"
                    aria-label={closeLabel}
                    data-modal-close
                >
                    ×
                </Button>
            </header>
            <div class="modal-card__content">{children}</div>
            <footer class="modal-card__footer">{actions}</footer>
        </Card>
    );
}
