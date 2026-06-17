export const config = { maxDuration: 60 };

import { createHash } from 'node:crypto';
import { applyApiSecurity } from './security.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const MEILI_INDEX_NAME = 'jarvis_web_pages';
const SEARCH_TIMEOUT_MS = 8_000;
const MEILI_SEARCH_TIMEOUT_MS = 4_000;
const MAX_QUERY_LENGTH = 500;

export const LIVE_SEARCH_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    error: Object.freeze({
        code: 'feature_disabled',
        message: 'Live search is temporarily disabled.'
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
    'usa.gov'
]);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    if (!hasLiveSearchProvider()) {
        return res.status(503).json({ ...LIVE_SEARCH_DISABLED_RESPONSE });
    }

    const query = normalizeSearchQuery(req.body?.query || req.body?.q || '');
    if (!query) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_request', message: 'Query is required.' },
            results: []
        });
    }

    try {
        const limit = clampInt(req.body?.limit, 8, 1, 20);
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

export function hasCrawlerIndex() {
    return Boolean(getMeiliHost() && getMeiliSearchKey());
}

export function hasLiveSearchProvider() {
    return hasCrawlerIndex() || hasSerperKey();
}

export async function searchCrawlerIndex(query, options = {}) {
    const host = getMeiliHost();
    const key = getMeiliSearchKey();
    const normalizedQuery = normalizeSearchQuery(query);
    if (!host || !key || !normalizedQuery) return [];

    const limit = clampInt(options.limit, 8, 1, 20);
    const index = encodeURIComponent(String(options.indexName || process.env.MEILI_INDEX || MEILI_INDEX_NAME).trim());
    let response;
    try {
        response = await fetchWithTimeout(`${host}/indexes/${index}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`
            },
            body: JSON.stringify({
                q: normalizedQuery,
                limit: Math.max(limit, 8),
                attributesToRetrieve: [
                    'title',
                    'description',
                    'text',
                    'url',
                    'canonicalUrl',
                    'domain',
                    'publishedAt',
                    'fetchedAt',
                    'trusted'
                ]
            })
        }, MEILI_SEARCH_TIMEOUT_MS);
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw createSearchError({
                code: 'crawler_index_timeout',
                httpStatus: 504,
                publicMessage: 'Crawler index search timed out.',
                retryable: true
            });
        }
        throw createSearchError({
            code: 'crawler_index_unreachable',
            httpStatus: 502,
            publicMessage: 'Crawler index could not be reached from the server.',
            retryable: true
        });
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw createCrawlerIndexStatusError(response.status, detail);
    }

    const data = await response.json();
    return normalizeMeiliResults(data, normalizedQuery).slice(0, limit);
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
    const weakCrawlerThreshold = Math.min(3, limit);
    let crawlerResults = [];
    let crawlerError = null;

    if (hasCrawlerIndex()) {
        try {
            crawlerResults = dedupeSearchResults(await searchCrawlerIndex(query, { limit })).slice(0, limit);
        } catch (error) {
            crawlerError = error;
        }
        if (crawlerResults.length >= weakCrawlerThreshold || !hasSerperKey()) {
            if (!crawlerResults.length && crawlerError) throw crawlerError;
            return buildSearchSummary(crawlerResults, {
                provider: 'crawler_index',
                indexResultCount: crawlerResults.length
            });
        }
    }

    if (hasSerperKey()) {
        const serperResults = await searchSerper(query, { limit: Math.max(limit, 10) });
        const merged = dedupeSearchResults([...crawlerResults, ...serperResults]).slice(0, limit);
        return buildSearchSummary(merged, {
            provider: crawlerResults.length ? 'crawler_index+serper' : 'serper',
            indexResultCount: crawlerResults.length
        });
    }

    return buildSearchSummary(crawlerResults, {
        provider: 'crawler_index',
        indexResultCount: crawlerResults.length
    });
}

export async function searchGoogleNewsRss() {
    return [];
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

function normalizeSerperResults(data, query) {
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const news = Array.isArray(data?.news) ? data.news : [];
    return [...organic, ...news]
        .map((item, index) => normalizeSerperItem(item, query, index))
        .filter(item => item.title && item.url);
}

function normalizeMeiliResults(data, query) {
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    return hits
        .map((item, index) => normalizeMeiliItem(item, query, index))
        .filter(item => item.title && item.url);
}

function normalizeMeiliItem(item, query, index) {
    const url = String(item?.canonicalUrl || item?.url || '').trim();
    const domain = String(item?.domain || getDomainFromUrl(url)).toLowerCase().replace(/^www\./, '');
    const description = String(item?.description || item?.text || '').replace(/\s+/g, ' ').trim();
    return {
        title: String(item?.title || domain || url).trim(),
        description: description.slice(0, 320),
        url,
        domain,
        source: domain || 'crawler_index',
        date: String(item?.publishedAt || item?.fetchedAt || '').trim(),
        position: index + 1,
        trusted: Boolean(item?.trusted) || isTrustedLiveSource(domain),
        query
    };
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
        provider: metadata.provider || 'unknown',
        indexResultCount: Number(metadata.indexResultCount) || 0
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
    if (upstreamStatus === 429) {
        return createSearchError({
            code: 'serper_quota_or_rate_limit',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rate limit or quota was hit${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: true
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

function createCrawlerIndexStatusError(status, detail = '') {
    const upstreamStatus = Number(status) || 0;
    const cleanDetail = sanitizeUpstreamDetail(detail);
    if (upstreamStatus === 401 || upstreamStatus === 403) {
        return createSearchError({
            code: 'crawler_index_auth_failed',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Crawler index rejected the search key${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    return createSearchError({
        code: 'crawler_index_error',
        httpStatus: 502,
        upstreamStatus,
        publicMessage: `Crawler index returned an error${upstreamStatus ? ` (${upstreamStatus})` : ''}${cleanDetail ? `: ${cleanDetail}` : '.'}`,
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

function getSerperApiKey() {
    return String(process.env.SERPER_API_KEY || process.env.SERPER_KEY || '').trim();
}

function getMeiliHost() {
    return String(process.env.MEILI_HOST || '').trim().replace(/\/+$/, '');
}

function getMeiliSearchKey() {
    return String(process.env.MEILI_SEARCH_KEY || '').trim();
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
    createCrawlerIndexStatusError,
    createSerperStatusError,
    getSerperKeyFingerprint,
    hasCrawlerIndex,
    normalizeMeiliResults,
    normalizeSerperResults,
    runVerifiedWebSearch,
    searchCrawlerIndex,
    isTrustedLiveSource
};
