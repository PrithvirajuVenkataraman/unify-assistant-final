(function () {
    if (window.__jarvisBootstrapLoaded) return;
    window.__jarvisBootstrapLoaded = true;

    window.JarvisApp = window.JarvisApp || {
        version: "1.0.0",
        modules: Object.create(null),
        register(name, api) {
            if (!name) return;
            this.modules[name] = api || {};
        }
    };
})();
