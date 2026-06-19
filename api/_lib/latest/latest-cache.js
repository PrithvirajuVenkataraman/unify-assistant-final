const ITEMS = new Map();
const MAX_ITEMS = 500;

export function saveItems(items = []) {
    let saved = 0;
    for (const item of Array.isArray(items) ? items : []) {
        const normalized = normalizeItem(item);
        if (!normalized.url) continue;
        ITEMS.set(normalized.url, normalized);
        saved += 1;
    }
    trimCache();
    return { saved, total: ITEMS.size };
}

export function getItems(options = {}) {
    const limit = clampInt(options.limit, 100, 1, MAX_ITEMS);
    return [...ITEMS.values()]
        .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))
        .slice(0, limit);
}

export function searchItems(query, options = {}) {
    const terms = tokenize(query);
    const limit = clampInt(options.limit, 8, 1, 50);
    return getItems({ limit: MAX_ITEMS })
        .map(item => ({ item, score: scoreItem(item, terms) }))
        .filter(entry => entry.score > 0 || !terms.length)
        .sort((a, b) => b.score - a.score || toTime(b.item.publishedAt) - toTime(a.item.publishedAt))
        .slice(0, limit)
        .map(entry => entry.item);
}

export function clearItems() {
    ITEMS.clear();
}

function normalizeItem(item) {
    const url = normalizeUrl(item?.url || item?.link || '');
    return {
        id: String(item?.id || url).trim(),
        title: normalizeWhitespace(item?.title || ''),
        url,
        summary: normalizeWhitespace(item?.summary || item?.description || ''),
        source: normalizeWhitespace(item?.source || item?.sourceName || ''),
        sourceId: normalizeWhitespace(item?.sourceId || ''),
        publishedAt: normalizeDate(item?.publishedAt || item?.date || ''),
        fetchedAt: normalizeDate(item?.fetchedAt || new Date().toISOString())
    };
}

function scoreItem(item, terms) {
    if (!terms.length) return 1;
    const title = String(item.title || '').toLowerCase();
    const summary = String(item.summary || '').toLowerCase();
    const source = String(item.source || '').toLowerCase();
    let score = Math.max(0, 20 - ageDays(item.publishedAt)) / 4;
    for (const term of terms) {
        if (title.includes(term)) score += 8;
        if (source.includes(term)) score += 5;
        if (summary.includes(term)) score += 2;
    }
    return score;
}

function trimCache() {
    const sorted = getItems({ limit: MAX_ITEMS + 1 });
    if (sorted.length <= MAX_ITEMS) return;
    ITEMS.clear();
    for (const item of sorted.slice(0, MAX_ITEMS)) {
        ITEMS.set(item.url, item);
    }
}

function tokenize(text) {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9.+-]{1,}/g) || []))
        .filter(term => !STOP_WORDS.has(term));
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'latest', 'recent', 'news', 'update', 'updates', 'release', 'releases']);

function normalizeUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function normalizeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTime(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
}

function ageDays(value) {
    const time = toTime(value);
    if (!time) return 30;
    return Math.max(0, (Date.now() - time) / 86_400_000);
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

// TODO: Replace or complement this in-memory cache with SQLite/Turso when usage grows.
export const __test = {
    ITEMS,
    normalizeItem,
    scoreItem
};
