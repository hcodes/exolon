/** @type {import('stylelint').Config} */
export default {
    extends: ['stylelint-config-recommended'],
    ignoreFiles: ['dist/**', 'node_modules/**', 'research/**'],
    overrides: [{ files: ['src/index.css'], rules: { 'selector-max-type': null } }],
    rules: {
        'declaration-no-important': true,
        // IDs are DOM/accessibility hooks; component styling uses classes.
        'selector-max-id': 0,
        // Component presentation is attached to BEM classes, not HTML tags.
        'selector-max-type': 0,
        // Stateful BEM and independent touch/TV/legacy contexts deliberately
        // override shared rules; selector ordering alone cannot model that DOM.
        'no-descending-specificity': null,
        // Screen-reader text still needs the Safari 9 clip fallback.
        'property-no-deprecated': [true, { ignoreProperties: ['clip'] }],
        // Match the project's kebab-case blocks, __elements and _modifiers.
        'selector-class-pattern': [
            '^(?!(?:is|has)-)[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:_[a-z0-9]+(?:-[a-z0-9]+)*)?$',
            {
                message:
                    'Use BEM classes: block, block__element, block_modifier; state modifiers belong to their block or element.',
            },
        ],
        // Layout uses Flexbox to retain the existing legacy browser support.
        'declaration-property-value-disallowed-list': {
            display: [/^(?:(?:block|inline)\s+)?(?:inline-)?grid$/i],
        },
    },
};
