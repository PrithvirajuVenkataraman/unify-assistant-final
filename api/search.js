export const config = { maxDuration: 60 };

import { createHash } from 'node:crypto';
import { applyApiSecurity } from './_lib/security.js';
import { classifyFreeLiveIntent, routeMessage } from './_lib/latest/router.js';
import { searchItems } from './_lib/latest/latest-cache.js';
import { ingestLatestSources } from './_lib/latest/latest-ingest.js';
import { runFreeLiveSearch } from './_lib/free-live/providers.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SEARCH_TIMEOUT_MS = 8_000;
const PUBLIC_SOURCE_TIMEOUT_MS = 5_000;
const GEMINI_SEARCH_TIMEOUT_MS = 6_000;
const MAX_QUERY_LENGTH = 500;
const LATEST_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let lastLatestRefreshAt = 0;

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

const OFFICIAL_SOURCE_SHORTCUTS = Object.freeze([
    { pattern: /\bisro|indian space research/i, label: 'ISRO official', url: 'https://www.isro.gov.in/', query: 'ISRO latest official update' },
    { pattern: /\bnasa\b/i, label: 'NASA official', url: 'https://www.nasa.gov/', query: 'NASA latest official update' },
    { pattern: /\bwho\b|world health organization/i, label: 'WHO official', url: 'https://www.who.int/', query: 'WHO latest official update' },
    { pattern: /\bcdc\b|centers for disease control/i, label: 'CDC official', url: 'https://www.cdc.gov/', query: 'CDC latest official update' },
    { pattern: /\brbi\b|reserve bank of india/i, label: 'RBI official', url: 'https://www.rbi.org.in/', query: 'RBI latest official update' },
    { pattern: /\bsec\b|securities and exchange commission/i, label: 'SEC official', url: 'https://www.sec.gov/', query: 'SEC latest official update' },
    { pattern: /\bimf\b|international monetary fund/i, label: 'IMF official', url: 'https://www.imf.org/', query: 'IMF latest official update' },
    { pattern: /\bworld bank\b/i, label: 'World Bank official', url: 'https://www.worldbank.org/', query: 'World Bank latest official update' },
    { pattern: /\bnoaa\b|hurricane|climate|weather alert/i, label: 'NOAA official', url: 'https://www.noaa.gov/', query: 'NOAA latest official update' },
    { pattern: /\busa\.gov|us government|u\.s\. government/i, label: 'USA.gov official', url: 'https://www.usa.gov/', query: 'USA.gov official update' },
    { pattern: /\bgov\.uk|uk government|british government/i, label: 'GOV.UK official', url: 'https://www.gov.uk/', query: 'GOV.UK official update' }
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
        const route = classifyFreeLiveIntent(query);
        if (route.route === 'live_required') {
            if (route.category === 'government' || route.category === 'news') {
                const search = await runVerifiedWebSearch(query, { limit });
                return res.status(200).json({
                    success: true,
                    query,
                    route,
                    category: route.category,
                    ...search
                });
            }
            const search = await runFreeLiveSearch(query, route, { limit });
            const unsupported = Boolean(search.unsupported);
            return res.status(200).json({
                success: !unsupported,
                disabled: false,
                query,
                route,
                error: unsupported
                    ? {
                        code: search.category === 'unsupported_free_live' ? 'unsupported_free_live' : 'clarification_required',
                        message: search.warnings?.[0] || 'No durable permanent-free live source is configured for this request.'
                    }
                    : undefined,
                ...buildSearchSummary(search.results || [], {
                    provider: search.provider || 'free_public_sources',
                    publicSourceCount: search.publicSourceCount || 0,
                    geminiEnhanced: false,
                    warnings: search.warnings || []
                }),
                category: search.category || route.category
            });
        }
        if (route.route === 'cached_latest') {
            const search = await runCachedLatestSearch(query, { limit });
            return res.status(200).json({
                success: true,
                query,
                route,
                ...search
            });
        }
        const search = await runVerifiedWebSearch(query, { limit });
        return res.status(200).json({
            success: true,
            query,
            route,
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

export async function runCachedLatestSearch(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    let results = searchItems(query, { limit });
    let refreshed = false;
    if (!results.length) {
        refreshed = await refreshLatestCacheIfStale(options);
        results = searchItems(query, { limit });
    }
    return buildSearchSummary(results.map(normalizeLatestCacheResult), {
        provider: 'latest_cache',
        publicSourceCount: results.length,
        geminiEnhanced: false,
        warnings: results.length ? [] : ['No cached freshness articles matched this request.'],
        refreshed
    });
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
    const plannedQueries = Array.isArray(options.plannedQueries) && options.plannedQueries.length
        ? options.plannedQueries
        : [normalizedQuery];
    const querySet = Array.from(new Set([
        normalizedQuery,
        ...plannedQueries.map(item => normalizeSearchQuery(item)).filter(Boolean),
        ...getOfficialSourceShortcuts(normalizedQuery).map(item => item.query)
    ])).slice(0, 5);
    const settled = await Promise.allSettled(querySet.flatMap(candidate => [
        searchWikipedia(candidate, { limit: Math.min(4, limit) }),
        searchGdeltNews(candidate, { limit })
    ]));
    const official = getOfficialSourceShortcuts(normalizedQuery).map((item, index) => normalizeOfficialShortcut(item, normalizedQuery, index));
    return settled
        .flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .concat(official)
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
    const planning = await buildGeminiSearchPlan(query).catch(error => ({
        queries: [],
        warning: `gemini_query_planning_failed:${String(error?.code || error?.message || 'unknown')}`
    }));
    const publicResults = rankSearchResults(query, dedupeSearchResults(await searchPublicSources(query, {
        limit,
        plannedQueries: planning.queries
    }))).slice(0, limit);
    let warnings = buildSearchWarnings(publicResults, planning.warning ? [planning.warning] : []);
    const enhanced = await enhanceResultsWithGemini(query, publicResults, { limit }).catch(error => ({
        results: publicResults,
        enhanced: false,
        warning: `gemini_enhancement_failed:${String(error?.code || error?.message || 'unknown')}`
    }));
    const enhancedResults = rankSearchResults(query, dedupeSearchResults(enhanced.results || publicResults)).slice(0, limit);
    warnings = buildSearchWarnings(enhancedResults, [
        ...warnings,
        enhanced.warning || ''
    ].filter(Boolean));

    return buildSearchSummary(enhancedResults, {
        provider: 'public_sources',
        publicSourceCount: enhancedResults.length,
        geminiEnhanced: Boolean(enhanced.enhanced),
        warnings
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
        sourceType: 'encyclopedia',
        sourceLabel: 'Wikipedia',
        date: '',
        freshness: 'reference',
        position: Number(item?.index || 1),
        trusted: true,
        qualitySignals: ['public_reference', 'trusted_source'],
        query
    };
}

function normalizeGdeltItem(item, query, index) {
    const url = String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    const date = normalizeGdeltDate(item?.seendate);
    const title = String(item?.title || '').trim();
    return {
        title,
        description: buildGdeltDescription(item, domain, date),
        url,
        domain,
        source: String(item?.domain || domain || 'GDELT').trim(),
        sourceType: isTrustedLiveSource(domain) ? 'trusted_news' : 'public_news',
        sourceLabel: `${domain || 'GDELT'} via GDELT`,
        date,
        freshness: date ? 'recent_or_indexed' : 'unknown',
        position: index + 1,
        trusted: isTrustedLiveSource(domain),
        qualitySignals: [
            'public_news_index',
            isTrustedLiveSource(domain) ? 'trusted_domain' : ''
        ].filter(Boolean),
        query
    };
}

function normalizeOfficialShortcut(item, query, index) {
    const domain = getDomainFromUrl(item.url);
    return {
        title: item.label,
        description: `Official source for ${item.label.replace(/\s+official$/i, '')} updates and primary information.`,
        url: item.url,
        domain,
        source: item.label,
        sourceType: 'official_source',
        sourceLabel: item.label,
        date: '',
        freshness: 'official_homepage',
        position: index + 1,
        trusted: true,
        qualitySignals: ['official_source', 'trusted_domain'],
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
        sourceType: isTrustedLiveSource(domain) ? 'trusted_web' : 'web',
        sourceLabel: String(item?.source || domain || 'web').trim(),
        date: String(item?.date || '').trim(),
        freshness: String(item?.date || '').trim() ? 'dated' : 'unknown',
        position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index + 1,
        trusted: isTrustedLiveSource(domain),
        qualitySignals: [
            'serper',
            isTrustedLiveSource(domain) ? 'trusted_domain' : ''
        ].filter(Boolean),
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
        publicSourceCount: Number(metadata.publicSourceCount) || 0,
        geminiEnhanced: Boolean(metadata.geminiEnhanced),
        warnings: Array.from(new Set((metadata.warnings || []).filter(Boolean))),
        refreshed: Boolean(metadata.refreshed)
    };
}

async function refreshLatestCacheIfStale(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && now - lastLatestRefreshAt < LATEST_REFRESH_INTERVAL_MS) return false;
    lastLatestRefreshAt = now;
    try {
        await ingestLatestSources({ timeoutMs: clampInt(options.timeoutMs, 2500, 1000, 5000) });
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeLatestCacheResult(item) {
    const domain = getDomainFromUrl(item.url);
    return {
        title: item.title,
        description: item.summary,
        url: item.url,
        domain,
        source: item.source || domain || 'latest cache',
        sourceType: 'cached_latest',
        sourceLabel: item.source || domain || 'Latest cache',
        date: item.publishedAt || '',
        freshness: item.publishedAt ? 'cached_recent' : 'cached',
        position: 0,
        trusted: true,
        qualitySignals: ['rss_atom_cache', 'free_source'],
        query: ''
    };
}

async function buildGeminiSearchPlan(query) {
    if (!hasGeminiKey()) return { queries: [], enhanced: false };
    const prompt = `Return strict JSON only.
Task: rewrite this user search query into 2 to 4 concise public-source search queries.
Prefer official domains, Wikipedia/Wikidata style entity terms, and news phrasing when current.
User query: ${JSON.stringify(query)}
JSON shape: {"queries":["..."]}`;
    const json = await callGeminiJson(prompt, { maxOutputTokens: 300, temperature: 0.1 });
    const queries = Array.isArray(json?.queries)
        ? json.queries.map(item => normalizeSearchQuery(item)).filter(Boolean).slice(0, 4)
        : [];
    return { queries, enhanced: queries.length > 0 };
}

async function enhanceResultsWithGemini(query, results, options = {}) {
    if (!hasGeminiKey() || !Array.isArray(results) || !results.length) {
        return { results, enhanced: false };
    }
    const limit = clampInt(options.limit, 8, 1, 20);
    const compact = results.slice(0, 12).map((item, index) => ({
        index,
        title: item.title,
        description: item.description,
        domain: item.domain,
        sourceType: item.sourceType,
        sourceLabel: item.sourceLabel,
        date: item.date,
        url: item.url
    }));
    const prompt = `Return strict JSON only.
Task: rank and improve source snippets for a public-source search result list.
Rules:
- Use only the fields provided. Do not invent facts.
- Keep descriptions concise, source-grounded, and under 180 characters.
- Prefer official_source, trusted_news, and exact query relevance.
- Return indexes from the input list only.
User query: ${JSON.stringify(query)}
Results JSON: ${JSON.stringify(compact)}
JSON shape: {"ranked":[{"index":0,"description":"...","reason":"..."}]}`;
    const json = await callGeminiJson(prompt, { maxOutputTokens: 900, temperature: 0.1 });
    const ranked = Array.isArray(json?.ranked) ? json.ranked : [];
    if (!ranked.length) return { results, enhanced: false };
    const byIndex = new Map(results.map((item, index) => [index, item]));
    const used = new Set();
    const enhanced = [];
    for (const entry of ranked) {
        const index = Number(entry?.index);
        const item = byIndex.get(index);
        if (!item || used.has(index)) continue;
        used.add(index);
        enhanced.push({
            ...item,
            description: String(entry?.description || item.description || '').replace(/\s+/g, ' ').trim().slice(0, 320),
            qualitySignals: Array.from(new Set([...(item.qualitySignals || []), 'gemini_ranked'])),
            geminiReason: String(entry?.reason || '').slice(0, 160)
        });
    }
    for (const [index, item] of byIndex) {
        if (!used.has(index)) enhanced.push(item);
    }
    return { results: enhanced.slice(0, limit), enhanced: true };
}

async function callGeminiJson(prompt, options = {}) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) return null;
    const model = String(process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
    const response = await fetchWithTimeout(`${GEMINI_GENERATE_URL}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1,
                maxOutputTokens: clampInt(options.maxOutputTokens, 700, 100, 1600)
            }
        })
    }, GEMINI_SEARCH_TIMEOUT_MS);
    if (!response.ok) {
        const error = createSearchError({
            code: 'gemini_search_enhancer_failed',
            httpStatus: 200,
            upstreamStatus: response.status,
            publicMessage: 'Gemini search enhancement failed.',
            retryable: true
        });
        throw error;
    }
    const data = await response.json();
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return extractJsonObject(text);
}

function extractJsonObject(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(raw);
    } catch (_) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch (_) {}
        }
    }
    return null;
}

function getOfficialSourceShortcuts(query) {
    return OFFICIAL_SOURCE_SHORTCUTS.filter(item => item.pattern.test(query));
}

function rankSearchResults(query, results) {
    const terms = tokenize(query);
    return [...(Array.isArray(results) ? results : [])].sort((a, b) => scoreSearchResult(b, terms) - scoreSearchResult(a, terms));
}

function scoreSearchResult(item, terms) {
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    const domain = String(item?.domain || '').toLowerCase();
    let score = 0;
    if (item?.sourceType === 'official_source') score += 30;
    if (item?.trusted) score += 12;
    if (item?.sourceType === 'trusted_news') score += 8;
    if (item?.sourceType === 'encyclopedia') score += 4;
    for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (domain.includes(term)) score += 4;
        if (description.includes(term)) score += 2;
    }
    if (item?.date) score += 2;
    return score;
}

function buildSearchWarnings(results, existing = []) {
    const warnings = [...existing];
    if (!Array.isArray(results) || !results.length) {
        warnings.push('No public-source results were found. This is not full-web coverage.');
    } else if (results.length < 3) {
        warnings.push('Limited public-source coverage; results may be incomplete.');
    }
    if (!results.some(item => item.sourceType === 'official_source' || item.trusted)) {
        warnings.push('No trusted or official source was found in the public-source result set.');
    }
    return Array.from(new Set(warnings.filter(Boolean)));
}

function buildGdeltDescription(item, domain, date) {
    const country = String(item?.sourcecountry || '').trim();
    const parts = [
        domain ? `Source: ${domain}` : '',
        date ? `Indexed: ${date.slice(0, 10)}` : '',
        country ? `Country: ${country}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : 'News article indexed by GDELT.';
}

function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
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

function getGeminiApiKey() {
    return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function hasGeminiKey() {
    return Boolean(getGeminiApiKey());
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
    buildGeminiSearchPlan,
    enhanceResultsWithGemini,
    isTrustedLiveSource,
    routeMessage,
    runCachedLatestSearch
};
