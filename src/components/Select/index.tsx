import classNames from 'classnames';
import type { JSX } from 'preact';
import './index.css';

export type SelectProps = JSX.IntrinsicElements['select'];

export function Select({ class: className = '', ...props }: SelectProps) {
    return <select {...props} class={classNames('select', className)} />;
}
