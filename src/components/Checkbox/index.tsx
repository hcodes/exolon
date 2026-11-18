import classNames from 'classnames';
import type { JSX } from 'preact';
import './index.css';

export type CheckboxProps = Omit<
    Extract<JSX.IntrinsicElements['input'], { type: 'checkbox' }>,
    'type'
>;

export function Checkbox({ class: className = '', ...props }: CheckboxProps) {
    return <input {...props} type="checkbox" class={classNames('checkbox', className)} />;
}
