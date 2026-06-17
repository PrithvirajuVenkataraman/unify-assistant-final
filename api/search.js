export const config = { maxDuration: 60 };

import { createHash } from 'node:crypto';
import { applyApiSecurity } from './security.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const SEARCH_TIMEOUT_MS = 8_000;
const PUBLIC_SOURCE_TIMEOUT_MS = 5_000;
const MAX_QUERY_LENGTH = 500;

export const LIVE_SEARCH_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    error: Object.freeze({
        code: 'feature_disabled',
        message: 'Live search is unavailable.'
    }),
    results: []
});

const TRUSTED_SOURCE_HOSTS = Object.freeze([
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'reuters.com',
    'thehindu.com',
    'indianexpress.com',
    'nytimes.com',
    'washingtonpost.com',
    'who.int',
    'nih.gov',
    'cdc.gov',
    'noaa.gov',
    'nasa.gov',
    'isro.gov.in',
    'rbi.org.in',
    'sec.gov',
    'imf.org',
    'worldbank.org',
    'europa.eu',
    'gov.uk',
    'usa.gov',
    'wikipedia.org',
    'wikidata.org'
]);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const query = normalizeSearchQuery(req.body?.query || req.body?.q || '');
    if (!query) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_request', message: 'Query is required.' },
            results: []
        });
    }

    try {
        const limit = clampInt(req.body?.limit || req.body?.maxResults, 8, 1, 20);
        const search = await runVerifiedWebSearch(query, { limit });
        return res.status(200).json({
            success: true,
            query,
            ...search
        });
    } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        return res.status(status).json({
            success: false,
            error: {
                code: String(error?.code || 'search_failed'),
                message: String(error?.publicMessage || error?.message || 'Live search failed.'),
                upstreamStatus: Number(error?.upstreamStatus) || undefined,
                retryable: error?.retryable !== false,
                keyFingerprint: getSerperKeyFingerprint()
            },
            results: []
        });
    }
}

export function hasSerperKey() {
    return Boolean(getSerperApiKey());
}

export function hasLiveSearchProvider() {
    return true;
}

export async function searchPublicSources(query, options = {}) {
    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [];
    const limit = clampInt(options.limit, 8, 1, 20);
    const settled = await Promise.allSettled([
        searchWikipedia(normalizedQuery, { limit: Math.min(5, limit) }),
        searchGdeltNews(normalizedQuery, { limit })
    ]);
    return settled
        .flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .filter(Boolean)
        .slice(0, Math.max(limit, 8));
}

export async function searchWikipedia(query, options = {}) {
    const limit = clampInt(options.limit, 4, 1, 10);
    const url = new URL(WIKIPEDIA_SEARCH_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', String(limit));
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
    const summaries = [];
    for (const hit of hits.slice(0, limit)) {
        const title = String(hit?.title || '').trim();
        if (!title) continue;
        const summary = await fetchWikipediaSummary(title).catch(() => null);
        summaries.push(normalizeWikipediaItem(summary || hit, query));
    }
    return summaries.filter(item => item.title && item.url);
}

export async function searchGdeltNews(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const url = new URL(GDELT_DOC_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(Math.min(limit, 20)));
    url.searchParams.set('sort', 'HybridRel');

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    return articles
        .map((item, index) => normalizeGdeltItem(item, query, index))
        .filter(item => item.title && item.url);
}

export async function searchSerper(query, options = {}) {
    const apiKey = getSerperApiKey();
    if (!apiKey) return [];

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [];

    const limit = clampInt(options.limit, 8, 1, 20);
    let response;
    try {
        response = await fetchWithTimeout(SERPER_SEARCH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey
            },
            body: JSON.stringify({
                q: normalizedQuery,
                num: Math.min(20, Math.max(10, limit))
            })
        }, SEARCH_TIMEOUT_MS);
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw createSearchError({
                code: 'search_timeout',
                httpStatus: 504,
                publicMessage: 'Live search timed out while contacting Serper.',
                retryable: true
            });
        }
        throw createSearchError({
            code: 'search_network_error',
            httpStatus: 502,
            publicMessage: 'Live search could not reach Serper from the server.',
            retryable: true
        });
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw createSerperStatusError(response.status, detail);
    }

    const data = await response.json();
    return normalizeSerperResults(data, normalizedQuery).slice(0, limit);
}

export async function runVerifiedWebSearch(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const publicResults = dedupeSearchResults(await searchPublicSources(query, { limit })).slice(0, limit);
    if (publicResults.length >= Math.min(3, limit) || !hasSerperKey()) {
        return buildSearchSummary(publicResults, {
            provider: 'public_sources',
            publicSourceCount: publicResults.length
        });
    }

    const serperResults = await searchSerper(query, { limit: Math.max(limit, 10) });
    const merged = dedupeSearchResults([...publicResults, ...serperResults]).slice(0, limit);
    return buildSearchSummary(merged, {
        provider: publicResults.length ? 'public_sources+serper' : 'serper',
        publicSourceCount: publicResults.length
    });
}

export async function searchGoogleNewsRss(query = '', options = {}) {
    return searchGdeltNews(query, options);
}

export function extractSearchTopic(text) {
    return String(text || '')
        .replace(/^\s*(latest|current|today'?s|recent|breaking)\s+/i, '')
        .replace(/\b(news|headlines|updates?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

export function isTrustedLiveSource(urlOrDomain) {
    const domain = String(urlOrDomain || '').includes('://')
        ? getDomainFromUrl(urlOrDomain)
        : String(urlOrDomain || '').toLowerCase().replace(/^www\./, '');
    if (!domain) return false;
    return TRUSTED_SOURCE_HOSTS.some(host => domain === host || domain.endsWith(`.${host}`));
}

async function fetchWikipediaSummary(title) {
    const url = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(String(title || '').replace(/\s+/g, '_'))}`;
    const response = await fetchWithTimeout(url, {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    return response.json();
}

function normalizeWikipediaItem(item, query) {
    const title = String(item?.title || '').trim();
    const pageUrl = String(item?.content_urls?.desktop?.page || '').trim() ||
        (title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}` : '');
    const description = stripHtml(String(item?.extract || item?.snippet || item?.description || '')).trim();
    const domain = getDomainFromUrl(pageUrl);
    return {
        title,
        description,
        url: pageUrl,
        domain,
        source: 'Wikipedia',
        date: '',
        position: Number(item?.index || 1),
        trusted: true,
        query
    };
}

function normalizeGdeltItem(item, query, index) {
    const url = String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    return {
        title: String(item?.title || '').trim(),
        description: String(item?.seendate || item?.sourcecountry || '').trim(),
        url,
        domain,
        source: String(item?.domain || domain || 'GDELT').trim(),
        date: normalizeGdeltDate(item?.seendate),
        position: index + 1,
        trusted: isTrustedLiveSource(domain),
        query
    };
}

function normalizeSerperResults(data, query) {
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const news = Array.isArray(data?.news) ? data.news : [];
    return [...organic, ...news]
        .map((item, index) => normalizeSerperItem(item, query, index))
        .filter(item => item.title && item.url);
}

function normalizeSerperItem(item, query, index) {
    const url = String(item?.link || item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    return {
        title: String(item?.title || '').trim(),
        description: String(item?.snippet || item?.description || '').trim(),
        url,
        domain,
        source: String(item?.source || domain || 'web').trim(),
        date: String(item?.date || '').trim(),
        position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index + 1,
        trusted: isTrustedLiveSource(domain),
        query
    };
}

function dedupeSearchResults(results) {
    const seen = new Set();
    const deduped = [];
    for (const item of Array.isArray(results) ? results : []) {
        const key = normalizeResultKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}

function buildSearchSummary(results, metadata = {}) {
    const distinctDomains = Array.from(new Set(results.map(item => item.domain).filter(Boolean)));
    const trustedCount = results.filter(item => item.trusted).length;
    return {
        results,
        distinctDomains,
        trustedCount,
        sourceCount: results.length,
        distinctDomainCount: distinctDomains.length,
        provider: metadata.provider || 'public_sources',
        publicSourceCount: Number(metadata.publicSourceCount) || 0
    };
}

function normalizeResultKey(item) {
    const url = String(item?.url || '').trim();
    if (url) {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            parsed.search = '';
            return parsed.toString().replace(/\/$/, '').toLowerCase();
        } catch (_) {
            return url.toLowerCase();
        }
    }
    return `${String(item?.title || '').toLowerCase()}|${String(item?.domain || '').toLowerCase()}`;
}

function normalizeSearchQuery(query) {
    return String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function createSerperStatusError(status, detail = '') {
    const upstreamStatus = Number(status) || 0;
    const cleanDetail = sanitizeUpstreamDetail(detail);
    if (upstreamStatus === 401 || upstreamStatus === 403) {
        return createSearchError({
            code: 'serper_auth_failed',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rejected the API key or permissions${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    if (upstreamStatus === 429 || /not enough credits|quota|credits/i.test(cleanDetail)) {
        return createSearchError({
            code: 'serper_quota_or_rate_limit',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rate limit, quota, or credits were exhausted${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    if (upstreamStatus >= 400 && upstreamStatus < 500) {
        return createSearchError({
            code: 'serper_request_rejected',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rejected the search request${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    return createSearchError({
        code: 'serper_upstream_error',
        httpStatus: 502,
        upstreamStatus,
        publicMessage: `Serper returned an upstream error${upstreamStatus ? ` (${upstreamStatus})` : ''}${cleanDetail ? `: ${cleanDetail}` : '.'}`,
        retryable: true
    });
}

function createSearchError({ code, httpStatus, upstreamStatus, publicMessage, retryable }) {
    const error = new Error(publicMessage);
    error.code = code;
    error.httpStatus = httpStatus;
    error.upstreamStatus = upstreamStatus;
    error.publicMessage = publicMessage;
    error.retryable = retryable;
    return error;
}

function sanitizeUpstreamDetail(detail) {
    const text = String(detail || '')
        .replace(/\s+/g, ' ')
        .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
        .trim();
    return text.slice(0, 220);
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

function stripHtml(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function normalizeGdeltDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{14}$/.test(raw)) return raw;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`;
}

function getSerperApiKey() {
    return String(process.env.SERPER_API_KEY || process.env.SERPER_KEY || '').trim();
}

function getSerperKeyFingerprint() {
    const key = getSerperApiKey();
    if (!key) return '';
    return createHash('sha256').update(key).digest('hex').slice(0, 10);
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export const __test = {
    liveSearchDisabledResponse: LIVE_SEARCH_DISABLED_RESPONSE,
    createSerperStatusError,
    getSerperKeyFingerprint,
    normalizeSerperResults,
    runVerifiedWebSearch,
    searchGdeltNews,
    searchPublicSources,
    searchWikipedia,
    isTrustedLiveSource
};
