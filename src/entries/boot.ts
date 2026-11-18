// ES5 on purpose: this runs before the compatibility bundle and its polyfills.
(function () {
    function modern() {
        if (!('noModule' in document.createElement('script'))) return false;
        try {
            // Module support alone would send Safari 11/12 code it cannot parse.
            if (!new Function('return ({value:1})?.value ?? 0;')()) return false;
            return Boolean(
                typeof Array.prototype.at === 'function' &&
                typeof Array.prototype.flatMap === 'function' &&
                typeof Object.fromEntries === 'function' &&
                typeof Object.values === 'function' &&
                typeof Promise.prototype.finally === 'function' &&
                typeof fetch === 'function' &&
                typeof URL === 'function' &&
                typeof URLSearchParams === 'function' &&
                typeof Element.prototype.closest === 'function' &&
                typeof Element.prototype.append === 'function'
            );
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ES5 requires a catch binding.
        } catch (error) {
            return false;
        }
    }
    var legacy = !modern() || /(?:\?|&)legacy=1(?:&|$)/.test(location.search);
    var script = document.createElement('script');
    if (legacy) {
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = './legacy/index.css';
        document.head.appendChild(css);
        script.src = './legacy/game.js';
    } else {
        script.type = 'module';
        script.src = './runtime/main.js';
    }
    document.head.appendChild(script);
})();
