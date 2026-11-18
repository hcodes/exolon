import classNames from 'classnames';
import type { JSX } from 'preact';
import './index.css';

export type ModalProps = Omit<JSX.IntrinsicElements['div'], 'role' | 'aria-modal'>;

/** Visibility is controlled by hidden; the shared modal controller owns focus and cancellation. */
export function Modal({ class: className = '', tabIndex = -1, ...props }: ModalProps) {
    return (
        <div
            {...props}
            role="dialog"
            aria-modal="true"
            tabIndex={tabIndex}
            class={classNames('modal', className)}
        />
    );
}
