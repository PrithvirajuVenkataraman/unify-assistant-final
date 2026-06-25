import { FREE_LIVE_SOURCES } from './source-registry.js';

const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const EONET_EVENTS_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const SPORT_SEARCH_URL = 'https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

const CRYPTO_IDS = Object.freeze({
    bitcoin: 'bitcoin',
    btc: 'bitcoin',
    ethereum: 'ethereum',
    eth: 'ethereum',
    solana: 'solana',
    dogecoin: 'dogecoin',
    doge: 'dogecoin'
});

export async function runFreeLiveSearch(query, route = {}, options = {}) {
    const category = String(route?.category || '').trim() || inferCategory(query);
    const limit = clampInt(options.limit, 8, 1, 20);
    if (category === 'weather') return searchWeather(query, { limit });
    if (category === 'crypto') return searchCrypto(query, { limit });
    if (category === 'disasters') return searchDisasters(query, { limit });
    if (category === 'sports') return searchSports(query, { limit });
    if (category === 'tourism_food_places') return searchTourismFoodPlaces(query, { limit });
    if (category === 'unsupported_free_live') return unsupportedFreeLive(query, category);
    return {
        results: [],
        provider: 'free_public_sources',
        publicSourceCount: 0,
        warnings: [`No dedicated permanent-free provider is configured for ${category || 'this request'}.`],
        unsupported: true,
        category: category || 'unsupported_free_live'
    };
}

export async function searchWeather(query, options = {}) {
    const location = extractLocation(query);
    if (!location) {
        return unsupportedFreeLive(query, 'weather', 'Weather needs a location. Ask with a city, for example "weather in Chennai".');
    }
    const source = FREE_LIVE_SOURCES.openMeteo;
    const geocodeUrl = new URL(OPEN_METEO_GEOCODE_URL);
    geocodeUrl.searchParams.set('name', location);
    geocodeUrl.searchParams.set('count', '1');
    geocodeUrl.searchParams.set('language', 'en');
    geocodeUrl.searchParams.set('format', 'json');
    const geoResponse = await fetchWithTimeout(geocodeUrl.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!geoResponse.ok) return emptyProvider('open-meteo', 'Weather location lookup failed.');
    const geo = await geoResponse.json();
    const place = Array.isArray(geo?.results) ? geo.results[0] : null;
    if (!place) return emptyProvider('open-meteo', `No weather location matched "${location}".`);

    const forecastUrl = new URL(OPEN_METEO_FORECAST_URL);
    forecastUrl.searchParams.set('latitude', String(place.latitude));
    forecastUrl.searchParams.set('longitude', String(place.longitude));
    forecastUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
    forecastUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
    forecastUrl.searchParams.set('timezone', 'auto');
    const forecastResponse = await fetchWithTimeout(forecastUrl.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!forecastResponse.ok) return emptyProvider('open-meteo', 'Weather forecast lookup failed.');
    const forecast = await forecastResponse.json();
    const current = forecast?.current || {};
    const units = forecast?.current_units || {};
    const titleLocation = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const description = [
        Number.isFinite(Number(current.temperature_2m)) ? `Temperature: ${current.temperature_2m}${units.temperature_2m || 'C'}` : '',
        Number.isFinite(Number(current.apparent_temperature)) ? `Feels like: ${current.apparent_temperature}${units.apparent_temperature || 'C'}` : '',
        Number.isFinite(Number(current.relative_humidity_2m)) ? `Humidity: ${current.relative_humidity_2m}${units.relative_humidity_2m || '%'}` : '',
        Number.isFinite(Number(current.wind_speed_10m)) ? `Wind: ${current.wind_speed_10m} ${units.wind_speed_10m || 'km/h'}` : ''
    ].filter(Boolean).join(' | ');
    return oneResult({
        title: `Current weather for ${titleLocation}`,
        description: description || 'Open-Meteo returned current weather conditions.',
        url: 'https://open-meteo.com/',
        source: source.name,
        sourceType: 'free_weather',
        freshness: 'current_model_data',
        trusted: true,
        qualitySignals: ['free_public_api', 'weather_model'],
        query
    }, 'open-meteo', 'weather');
}

export async function searchCrypto(query, options = {}) {
    const id = extractCryptoId(query);
    if (!id) return unsupportedFreeLive(query, 'crypto', 'Crypto price lookup needs a supported asset such as bitcoin, ethereum, solana, or dogecoin.');
    const source = FREE_LIVE_SOURCES.coingecko;
    const url = new URL(COINGECKO_SIMPLE_PRICE_URL);
    url.searchParams.set('ids', id);
    url.searchParams.set('vs_currencies', 'usd,inr');
    url.searchParams.set('include_24hr_change', 'true');
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return emptyProvider('coingecko', 'CoinGecko public price lookup failed.');
    const data = await response.json();
    const item = data?.[id] || {};
    const usd = Number(item.usd);
    const inr = Number(item.inr);
    const change = Number(item.usd_24h_change);
    if (!Number.isFinite(usd) && !Number.isFinite(inr)) return emptyProvider('coingecko', 'CoinGecko returned no public price for that asset.');
    return oneResult({
        title: `${formatCryptoName(id)} public price`,
        description: [
            Number.isFinite(usd) ? `USD ${usd}` : '',
            Number.isFinite(inr) ? `INR ${inr}` : '',
            Number.isFinite(change) ? `24h USD change ${change.toFixed(2)}%` : ''
        ].filter(Boolean).join(' | '),
        url: 'https://www.coingecko.com/',
        source: source.name,
        sourceType: 'free_crypto_price',
        freshness: 'public_price_snapshot',
        trusted: true,
        qualitySignals: ['free_public_api', 'market_snapshot'],
        query
    }, 'coingecko', 'crypto');
}

export async function searchDisasters(query, options = {}) {
    const source = FREE_LIVE_SOURCES.eonet;
    const url = new URL(EONET_EVENTS_URL);
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', String(clampInt(options.limit, 8, 1, 20)));
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return emptyProvider('nasa-eonet', 'NASA EONET lookup failed.');
    const data = await response.json();
    const terms = tokenize(query);
    const events = Array.isArray(data?.events) ? data.events : [];
    const results = events
        .filter(event => matchesTerms(`${event?.title || ''} ${event?.categories?.map(c => c.title).join(' ') || ''}`, terms))
        .slice(0, clampInt(options.limit, 8, 1, 20))
        .map((event, index) => normalizeResult({
            title: String(event?.title || 'Natural event').trim(),
            description: buildEonetDescription(event),
            url: String(event?.sources?.[0]?.url || 'https://eonet.gsfc.nasa.gov/').trim(),
            source: source.name,
            sourceType: 'free_disaster_event',
            date: String(event?.geometry?.[0]?.date || '').trim(),
            freshness: 'open_event',
            trusted: true,
            qualitySignals: ['free_public_api', 'natural_event_tracker'],
            position: index + 1,
            query
        }));
    return summary(results, 'nasa-eonet', 'disasters', results.length ? [] : ['No matching open NASA EONET event was found.']);
}

export async function searchSports(query, options = {}) {
    const league = extractSportsLeague(query);
    if (!league) {
        return unsupportedFreeLive(query, 'sports', 'Free sports coverage needs a league or sport name; live scores may be unavailable on permanent-free sources.');
    }
    const source = FREE_LIVE_SOURCES.theSportsDb;
    const url = new URL(SPORT_SEARCH_URL);
    url.searchParams.set('l', league);
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return emptyProvider('thesportsdb', 'TheSportsDB lookup failed.');
    const data = await response.json();
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    const results = teams.slice(0, clampInt(options.limit, 8, 1, 20)).map((team, index) => normalizeResult({
        title: String(team?.strTeam || team?.strAlternate || 'Sports team').trim(),
        description: String(team?.strDescriptionEN || team?.strLeague || source.limitations).replace(/\s+/g, ' ').trim().slice(0, 260),
        url: String(team?.strWebsite ? `https://${String(team.strWebsite).replace(/^https?:\/\//i, '')}` : 'https://www.thesportsdb.com/').trim(),
        source: source.name,
        sourceType: 'free_sports_reference',
        freshness: 'sports_reference',
        trusted: false,
        qualitySignals: ['free_public_api', 'limited_sports_coverage'],
        position: index + 1,
        query
    }));
    return summary(results, 'thesportsdb', 'sports', results.length ? ['Free sports live-score coverage is limited.'] : ['No free sports source result matched this request.']);
}

export async function searchTourismFoodPlaces(query, options = {}) {
    const topic = extractPlaceTopic(query);
    if (!topic) {
        return unsupportedFreeLive(query, 'tourism_food_places', 'Place or tourism lookup needs a place or topic.');
    }
    const [wiki, osm] = await Promise.allSettled([
        searchWikipediaTopic(topic, query, options),
        searchOsmPlace(topic, query, options)
    ]);
    const results = [
        ...(wiki.status === 'fulfilled' ? wiki.value : []),
        ...(osm.status === 'fulfilled' ? osm.value : [])
    ].slice(0, clampInt(options.limit, 8, 1, 20));
    return summary(results, 'wikimedia+openstreetmap', 'tourism_food_places', [
        'Free place data does not include reliable reviews, rankings, or open-now guarantees.'
    ]);
}

function unsupportedFreeLive(query, category, message = 'No durable permanent-free live source is configured for this request.') {
    return {
        results: [],
        provider: 'unsupported_free_live',
        publicSourceCount: 0,
        warnings: [message],
        unsupported: true,
        category,
        query
    };
}

function emptyProvider(provider, warning) {
    return {
        results: [],
        provider,
        publicSourceCount: 0,
        warnings: [warning],
        unsupported: false
    };
}

function oneResult(item, provider, category) {
    return summary([normalizeResult(item)], provider, category, []);
}

function summary(results, provider, category, warnings = []) {
    return {
        results,
        provider,
        publicSourceCount: results.length,
        warnings,
        unsupported: false,
        category
    };
}

async function searchWikipediaTopic(topic, query, options = {}) {
    const source = FREE_LIVE_SOURCES.wikimedia;
    const searchUrl = new URL(WIKIPEDIA_SEARCH_URL);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', topic);
    searchUrl.searchParams.set('srlimit', String(Math.min(3, clampInt(options.limit, 8, 1, 20))));
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');
    const response = await fetchWithTimeout(searchUrl.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
    const results = [];
    for (const hit of hits) {
        const title = String(hit?.title || '').trim();
        if (!title) continue;
        const summaryUrl = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
        const summaryResponse = await fetchWithTimeout(summaryUrl, {
            headers: { Accept: 'application/json' }
        }, source.timeoutMs).catch(() => null);
        const summaryData = summaryResponse?.ok ? await summaryResponse.json() : null;
        results.push(normalizeResult({
            title,
            description: String(summaryData?.extract || hit?.snippet || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260),
            url: String(summaryData?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`),
            source: source.name,
            sourceType: 'free_reference',
            freshness: 'reference',
            trusted: true,
            qualitySignals: ['free_public_api', 'reference_source'],
            query
        }));
    }
    return results;
}

async function searchOsmPlace(topic, query, options = {}) {
    const source = FREE_LIVE_SOURCES.osm;
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set('q', topic);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(Math.min(3, clampInt(options.limit, 8, 1, 20))));
    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistantFreeLive/1.0'
        }
    }, source.timeoutMs);
    if (!response.ok) return [];
    const data = await response.json();
    const places = Array.isArray(data) ? data : [];
    return places.map((place, index) => normalizeResult({
        title: String(place?.name || place?.display_name || 'OpenStreetMap place').trim(),
        description: String(place?.display_name || source.limitations).trim().slice(0, 260),
        url: String(place?.osm_id ? `https://www.openstreetmap.org/${place?.osm_type || 'node'}/${place.osm_id}` : 'https://www.openstreetmap.org/'),
        source: source.name,
        sourceType: 'free_place_data',
        freshness: 'map_reference',
        trusted: false,
        qualitySignals: ['free_public_api', 'open_map_data'],
        position: index + 1,
        query
    }));
}

function normalizeResult(item) {
    const url = String(item?.url || '').trim();
    return {
        title: String(item?.title || '').trim(),
        description: String(item?.description || '').trim(),
        url,
        domain: getDomainFromUrl(url),
        source: String(item?.source || '').trim(),
        sourceType: String(item?.sourceType || 'free_public_source').trim(),
        sourceLabel: String(item?.source || '').trim(),
        date: String(item?.date || '').trim(),
        freshness: String(item?.freshness || 'unknown').trim(),
        position: Number(item?.position) || 1,
        trusted: Boolean(item?.trusted),
        qualitySignals: Array.isArray(item?.qualitySignals) ? item.qualitySignals.map(String) : ['free_public_source'],
        query: String(item?.query || '').trim()
    };
}

function inferCategory(query) {
    const t = String(query || '').toLowerCase();
    if (/\bweather|forecast|temperature\b/.test(t)) return 'weather';
    if (/\bbitcoin|btc|ethereum|eth|crypto\b/.test(t)) return 'crypto';
    if (/\bsports?|score|fixture|standings|ipl|nba|nfl|epl\b/.test(t)) return 'sports';
    if (/\bearthquake|wildfire|flood|cyclone|hurricane|tsunami|volcano\b/.test(t)) return 'disasters';
    if (/\btourism|tourist|travel|places to visit|attractions?|temple|museum|hotel|where am i|where i am\b/.test(t)) return 'tourism_food_places';
    return 'unsupported_free_live';
}

function extractLocation(query) {
    const text = String(query || '').replace(/[?.!]+$/g, '').trim();
    const match = text.match(/\b(?:in|at|for|near)\s+([a-zA-Z][a-zA-Z\s.'-]{1,80})$/i);
    if (match?.[1]) return match[1].trim();
    return '';
}

function extractCryptoId(query) {
    const t = String(query || '').toLowerCase();
    for (const [name, id] of Object.entries(CRYPTO_IDS)) {
        if (new RegExp(`\\b${name}\\b`, 'i').test(t)) return id;
    }
    return '';
}

function extractSportsLeague(query) {
    const t = String(query || '').toLowerCase();
    const aliases = [
        ['ipl', 'Indian Premier League'],
        ['nba', 'NBA'],
        ['nfl', 'NFL'],
        ['epl', 'English Premier League'],
        ['premier league', 'English Premier League'],
        ['cricket', 'Indian Premier League'],
        ['football', 'English Premier League'],
        ['soccer', 'English Premier League']
    ];
    for (const [key, value] of aliases) {
        if (t.includes(key)) return value;
    }
    return '';
}

function extractPlaceTopic(query) {
    return String(query || '')
        .replace(/\b(latest|current|today|now|near me|open now|best|top|show me|find|search)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function formatCryptoName(id) {
    return String(id || '').split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function buildEonetDescription(event) {
    const categories = Array.isArray(event?.categories) ? event.categories.map(c => c?.title).filter(Boolean).join(', ') : '';
    const date = String(event?.geometry?.[0]?.date || '').trim();
    return [categories ? `Category: ${categories}` : '', date ? `Observed: ${date}` : 'Open natural event'].filter(Boolean).join(' | ');
}

function tokenize(text) {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []));
}

function matchesTerms(text, terms) {
    if (!terms.length) return true;
    const lower = String(text || '').toLowerCase();
    return terms.some(term => lower.includes(term));
}

function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export const __test = {
    extractCryptoId,
    extractLocation,
    extractPlaceTopic,
    extractSportsLeague,
    normalizeResult
};
