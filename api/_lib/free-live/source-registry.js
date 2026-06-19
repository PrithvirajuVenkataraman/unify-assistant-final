export const FREE_LIVE_CATEGORIES = Object.freeze([
    'news',
    'government',
    'weather',
    'disasters',
    'sports',
    'crypto',
    'tourism_food_places',
    'unsupported_free_live'
]);

export const FREE_LIVE_SOURCES = Object.freeze({
    gdelt: {
        id: 'gdelt',
        name: 'GDELT Doc API',
        category: 'news',
        attribution: 'GDELT Project',
        timeoutMs: 5000,
        cacheTtlMs: 10 * 60 * 1000,
        limitations: 'Broad public news index; coverage can miss very recent or local items.'
    },
    openMeteo: {
        id: 'open-meteo',
        name: 'Open-Meteo',
        category: 'weather',
        attribution: 'Open-Meteo',
        timeoutMs: 5000,
        cacheTtlMs: 10 * 60 * 1000,
        limitations: 'Forecast/model data by coordinates; location must be resolvable.'
    },
    coingecko: {
        id: 'coingecko',
        name: 'CoinGecko public API',
        category: 'crypto',
        attribution: 'CoinGecko',
        timeoutMs: 5000,
        cacheTtlMs: 60 * 1000,
        limitations: 'Public/demo endpoint availability and rate limits can vary.'
    },
    eonet: {
        id: 'nasa-eonet',
        name: 'NASA EONET',
        category: 'disasters',
        attribution: 'NASA Earth Observatory Natural Event Tracker',
        timeoutMs: 5000,
        cacheTtlMs: 15 * 60 * 1000,
        limitations: 'Natural event tracker; not an emergency alerting service.'
    },
    theSportsDb: {
        id: 'thesportsdb',
        name: 'TheSportsDB',
        category: 'sports',
        attribution: 'TheSportsDB',
        timeoutMs: 5000,
        cacheTtlMs: 5 * 60 * 1000,
        limitations: 'Free sports coverage is limited and not guaranteed for live scores.'
    },
    wikimedia: {
        id: 'wikimedia',
        name: 'Wikimedia APIs',
        category: 'tourism_food_places',
        attribution: 'Wikimedia',
        timeoutMs: 5000,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Reference and travel background, not reviews or live opening status.'
    },
    osm: {
        id: 'openstreetmap',
        name: 'OpenStreetMap public APIs',
        category: 'tourism_food_places',
        attribution: 'OpenStreetMap contributors',
        timeoutMs: 5000,
        cacheTtlMs: 24 * 60 * 60 * 1000,
        limitations: 'Use lightly, cache results, and do not treat as review/ranking data.'
    }
});

export function getFreeLiveSources() {
    return FREE_LIVE_SOURCES;
}
