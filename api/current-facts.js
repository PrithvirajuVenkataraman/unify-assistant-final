export const config = { maxDuration: 60 };

import { applyApiSecurity } from './_lib/security.js';
import { searchItems } from './_lib/latest/latest-cache.js';

export const LIVE_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    resolved: false,
    error: Object.freeze({
        code: 'feature_disabled',
        message: 'Live search is temporarily disabled.'
    }),
    answer: '',
    sources: []
});

export const CACHE_EMPTY_RESPONSE = Object.freeze({
    success: true,
    disabled: false,
    resolved: false,
    answer: '',
    sources: [],
    error: Object.freeze({
        code: 'cache_miss',
        message: 'No cached freshness articles matched this request.'
    })
});

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'current-facts',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const query = normalizeQuery(req.body?.query || req.body?.q || req.body?.message || '');
    if (!query) {
        return res.status(400).json({
            success: false,
            resolved: false,
            error: { code: 'invalid_request', message: 'Query is required.' },
            sources: []
        });
    }

    const sources = rankCurrentFactItems(query, searchItems(query, { limit: 8 }));
    if (!sources.length) {
        return res.status(200).json({
            ...CACHE_EMPTY_RESPONSE,
            query
        });
    }

    return res.status(200).json({
        success: true,
        disabled: false,
        resolved: true,
        query,
        answer: buildCachedAnswer(query, sources),
        sources
    });
}

export function rankCurrentFactItems(query, items = []) {
    const terms = tokenize(query);
    return [...(Array.isArray(items) ? items : [])]
        .map(item => ({ item: normalizeSource(item), score: scoreCurrentFactItem(item, terms) }))
        .filter(entry => entry.item.url)
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.item);
}

function buildCachedAnswer(query, sources) {
    const top = sources[0];
    return `I found cached freshness articles for "${query}". Most relevant: ${top.title}${top.source ? ` (${top.source})` : ''}.`;
}

function scoreCurrentFactItem(item, terms) {
    const title = String(item?.title || '').toLowerCase();
    const summary = String(item?.summary || '').toLowerCase();
    let score = Math.max(0, 30 - ageDays(item?.publishedAt));
    for (const term of terms) {
        if (title.includes(term)) score += 10;
        if (summary.includes(term)) score += 2;
    }
    return score;
}

function normalizeSource(item) {
    return {
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
        source: String(item?.source || '').trim(),
        summary: String(item?.summary || '').trim(),
        publishedAt: String(item?.publishedAt || '').trim()
    };
}

function tokenize(text) {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9.+-]{1,}/g) || []))
        .filter(term => !STOP_WORDS.has(term));
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'latest', 'recent', 'news', 'update', 'updates', 'current']);

function ageDays(value) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return 30;
    return Math.max(0, (Date.now() - time) / 86_400_000);
}

function normalizeQuery(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export const __test = {
    liveDisabledResponse: LIVE_DISABLED_RESPONSE,
    cacheEmptyResponse: CACHE_EMPTY_RESPONSE,
    rankCurrentFactItems,
    scoreCurrentFactItem
};
