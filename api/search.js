export const config = { maxDuration: 60 };

import { createHash } from 'node:crypto';
import { applyApiSecurity } from './_lib/security.js';
import { classifyFreeLiveIntent, routeMessage } from './_lib/latest/router.js';
import { searchItems } from './_lib/latest/latest-cache.js';
import { ingestLatestSources } from './_lib/latest/latest-ingest.js';
import { runFreeLiveSearch } from './_lib/free-live/providers.js';
import { extractWithCrawl4Ai } from './_lib/crawl4ai-client.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const BRITANNICA_SEARCH_URL = 'https://www.britannica.com/search';
const ARCHIVE_TODAY_SEARCH_URL = 'https://archive.today/search/';
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SEARCH_TIMEOUT_MS = 8_000;
const PUBLIC_SOURCE_TIMEOUT_MS = 5_000;
const GEMINI_SEARCH_TIMEOUT_MS = 6_000;
const MAX_QUERY_LENGTH = 500;
const LATEST_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let lastLatestRefreshAt = 0;

const LOOKUP_ONLY_SOURCE_TYPES = new Set([
    'reference_lookup',
    'archive_lookup',
    'community_discussion'
]);

const COMMON_QUERY_TERMS = new Set([
    'who', 'what', 'when', 'where', 'which', 'current', 'latest', 'present',
    'the', 'of', 'for', 'in', 'is', 'are', 'and', 'or', 'official', 'source'
]);

const GOVERNMENT_ROLE_ALIASES = Object.freeze([
    { role: 'ceo', pattern: /\bceo\b|\bchief\s+executive\s+officer\b/i, property: 'P169', organizationRole: true },
    { role: 'prime minister', pattern: /\bprime\s+minister\b|\bpm\b/i, property: 'P6' },
    { role: 'chief minister', pattern: /\bchief\s+minister\b|\bcm\b/i, property: 'P39' },
    { role: 'first minister', pattern: /\bfirst\s+minister\b/i, property: 'P39' },
    { role: 'president', pattern: /\bpresident\b/i, property: 'P35' },
    { role: 'governor', pattern: /\bgovernor\b/i, property: 'P39' },
    { role: 'premier', pattern: /\bpremier\b/i, property: 'P39' },
    { role: 'mayor', pattern: /\bmayor\b/i, property: 'P39' },
    { role: 'head of government', pattern: /\bhead\s+of\s+government\b/i, property: 'P6' },
    { role: 'head of state', pattern: /\bhead\s+of\s+state\b/i, property: 'P35' }
]);

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
    'wikidata.org',
    'britannica.com',
    'reddit.com',
    'archive.today',
    'archive.ph',
    'archive.is'
]);

const OFFICIAL_SOURCE_SHORTCUTS = Object.freeze([
    { pattern: /\bisro|indian space research/i, label: 'ISRO official', url: 'https://www.isro.gov.in/', query: 'ISRO latest official update' },
    { pattern: /\bnasa\b/i, label: 'NASA official', url: 'https://www.nasa.gov/', query: 'NASA latest official update' },
    { pattern: /\bWHO\b|[Ww]orld\s+[Hh]ealth\s+[Oo]rganization/, label: 'WHO official', url: 'https://www.who.int/', query: 'WHO latest official update' },
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
                    query,
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
        query,
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
    const governmentRoleResults = await searchGovernmentRole(normalizedQuery, { limit: Math.min(3, limit) }).catch(() => []);
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
        searchWikidata(candidate, { limit: Math.min(3, limit) }),
        searchReddit(candidate, { limit: Math.min(3, limit) }),
        searchGdeltNews(candidate, { limit })
    ]));
    const official = await Promise.all(getOfficialSourceShortcuts(normalizedQuery)
        .map((item, index) => normalizeOfficialShortcut(item, normalizedQuery, index)));
    const referenceLookups = buildReferenceLookupResults(normalizedQuery, official.length);
    return settled
        .flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .concat(governmentRoleResults)
        .concat(official)
        .concat(referenceLookups)
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

export async function searchWikidata(query, options = {}) {
    const limit = clampInt(options.limit, 3, 1, 10);
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('uselang', 'en');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.search) ? data.search : [];
    return hits
        .map((item, index) => normalizeWikidataItem(item, query, index))
        .filter(item => item.title && item.url);
}

export async function searchGovernmentRole(query, options = {}) {
    const intent = parseGovernmentRoleQuery(query);
    if (!intent) return [];
    const limit = clampInt(options.limit, 3, 1, 6);
    const jurisdiction = await resolveWikidataEntity(intent.jurisdiction);
    if (!jurisdiction?.id) return [];
    const sparql = buildGovernmentRoleSparql(intent, jurisdiction.id, limit);
    const response = await fetchWithTimeout(`${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(sparql)}&format=json`, {
        headers: {
            Accept: 'application/sparql-results+json, application/json',
            'User-Agent': 'JARVISAssistant/1.0 public-source-search'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    return normalizeGovernmentRoleBindings(data, intent, jurisdiction, query).slice(0, limit);
}

export async function resolveWikidataEntity(label) {
    const query = normalizeSearchQuery(label);
    if (!query) return null;
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('uselang', 'en');
    url.searchParams.set('limit', '5');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    const data = await response.json();
    const hits = Array.isArray(data?.search) ? data.search : [];
    const ranked = hits
        .map((item, index) => ({
            id: String(item?.id || '').trim(),
            label: String(item?.label || '').trim(),
            description: String(item?.description || '').trim(),
            conceptUri: String(item?.concepturi || '').trim(),
            score: scoreWikidataEntityCandidate(query, item, index)
        }))
        .filter(item => /^Q\d+$/.test(item.id) && item.label)
        .sort((a, b) => b.score - a.score);
    return ranked[0] || null;
}

export async function searchReddit(query, options = {}) {
    const limit = clampInt(options.limit, 3, 1, 10);
    const url = new URL(REDDIT_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('t', 'year');

    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'JARVISAssistant/1.0 public-source-search'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const posts = Array.isArray(data?.data?.children) ? data.data.children : [];
    return posts
        .map((entry, index) => normalizeRedditItem(entry?.data || entry, query, index))
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
    const publicResults = rankSources(query, dedupeSearchResults(await searchPublicSources(query, {
        limit,
        plannedQueries: planning.queries
    })).filter(item => isValidCitationSource(item, query))).slice(0, limit);
    let warnings = buildSearchWarnings(publicResults, planning.warning ? [planning.warning] : []);
    const enhanced = await enhanceResultsWithGemini(query, publicResults, { limit }).catch(error => ({
        results: publicResults,
        enhanced: false,
        warning: `gemini_enhancement_failed:${String(error?.code || error?.message || 'unknown')}`
    }));
    const enhancedResults = rankSources(query, dedupeSearchResults(enhanced.results || publicResults)
        .filter(item => isValidCitationSource(item, query))).slice(0, limit);
    warnings = buildSearchWarnings(enhancedResults, [
        ...warnings,
        enhanced.warning || ''
    ].filter(Boolean));

    return buildSearchSummary(enhancedResults, {
        query,
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

function normalizeWikidataItem(item, query, index) {
    const id = String(item?.id || '').trim();
    const title = String(item?.label || item?.title || id).trim();
    const description = String(item?.description || item?.match?.text || '').replace(/\s+/g, ' ').trim();
    const url = id ? `https://www.wikidata.org/wiki/${encodeURIComponent(id)}` : String(item?.concepturi || '').trim();
    const domain = getDomainFromUrl(url);
    return {
        title,
        description: description || 'Structured public entity data from Wikidata.',
        url,
        domain,
        source: 'Wikidata',
        sourceType: 'structured_reference',
        sourceLabel: 'Wikidata',
        date: '',
        freshness: 'reference',
        position: index + 1,
        trusted: true,
        qualitySignals: ['public_reference', 'structured_entity_data', 'trusted_source'],
        evidenceLevel: 'reference_summary',
        query
    };
}

export function parseGovernmentRoleQuery(query) {
    const raw = normalizeSearchQuery(query);
    if (!raw) return null;
    const roleEntry = GOVERNMENT_ROLE_ALIASES.find(item => item.pattern.test(raw));
    if (!roleEntry) return null;

    const roleTextMatch = raw.match(roleEntry.pattern);
    const roleText = String(roleTextMatch?.[0] || roleEntry.role).trim();
    const escapedRoleText = escapeRegex(roleText);
    const patterns = [
        new RegExp(`\\b(?:who\\s+is|what\\s+is)?\\s*(?:the\\s+)?(?:current\\s+|latest\\s+)?${escapedRoleText}\\s+(?:of|for|in)\\s+(.+?)[?.!]*$`, 'i'),
        new RegExp(`\\b(.+?)\\s+(?:current\\s+|latest\\s+)?${escapedRoleText}\\b[?.!]*$`, 'i')
    ];
    let jurisdiction = '';
    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1]) {
            jurisdiction = cleanGovernmentRoleJurisdiction(match[1]);
            break;
        }
    }
    if (!jurisdiction) {
        const withoutLead = raw
            .replace(/^\s*(who|what)\s+is\s+(?:the\s+)?/i, ' ')
            .replace(/\b(current|latest|present|incumbent)\b/gi, ' ');
        const parts = withoutLead.split(roleTextMatch?.[0] || roleEntry.role);
        jurisdiction = cleanGovernmentRoleJurisdiction(parts[1] || parts[0] || '');
    }
    if (!jurisdiction || jurisdiction.length < 2) return null;
    return {
        role: roleEntry.role,
        roleText,
        jurisdiction,
        property: roleEntry.property
    };
}

function cleanGovernmentRoleJurisdiction(value) {
    return String(value || '')
        .replace(/\b(current|latest|present|incumbent|official|government|leader|office|holder|name|country|state|province)\b$/gi, ' ')
        .replace(/^[,:\s]+|[,:\s?!.]+$/g, '')
        .replace(/\s*,\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildGovernmentRoleSparql(intent, jurisdictionId, limit = 3) {
    const qid = String(jurisdictionId || '').trim();
    if (!/^Q\d+$/.test(qid)) return '';
    const roleFilter = escapeSparqlString(intent.role);
    const directProperty = ['P35', 'P6', 'P169'].includes(intent.property) ? intent.property : '';
    const directBranch = directProperty
        ? `{
  wd:${qid} wdt:${directProperty} ?holder.
  BIND("${escapeSparqlString(intent.role)}" AS ?officeLabel)
  BIND("wdt:${directProperty}" AS ?claimType)
}`
        : '';
    const p39Branch = intent.organizationRole ? '' : `{
    ?holder p:P39 ?statement.
    ?statement ps:P39 ?office.
    FILTER NOT EXISTS { ?statement pq:P582 ?end. }
    OPTIONAL { ?statement pq:P580 ?start. }
    ?office rdfs:label ?officeLabel.
    FILTER(LANG(?officeLabel) = "en")
    FILTER(CONTAINS(LCASE(STR(?officeLabel)), "${roleFilter}"))
    {
      ?office wdt:P1001 wd:${qid}.
    } UNION {
      ?office wdt:P17 wd:${qid}.
    } UNION {
      ?holder wdt:P131* wd:${qid}.
    }
    BIND("p:P39" AS ?claimType)
  }`;
    const branches = [directBranch, p39Branch].filter(Boolean).join(' UNION ');
    return `
SELECT ?holder ?holderLabel ?office ?officeLabel ?start ?article ?claimType WHERE {
  ${branches}
  OPTIONAL {
    ?article schema:about ?holder;
      schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?start)
LIMIT ${clampInt(limit, 3, 1, 6)}`;
}

function normalizeGovernmentRoleBindings(data, intent, jurisdiction, query) {
    const bindings = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];
    return bindings
        .map((binding, index) => normalizeGovernmentRoleBinding(binding, intent, jurisdiction, query, index))
        .filter(item => item.title && item.url);
}

function normalizeGovernmentRoleBinding(binding, intent, jurisdiction, query, index) {
    const holderName = bindingValue(binding?.holderLabel);
    const holderUri = bindingValue(binding?.holder);
    const holderId = extractWikidataId(holderUri);
    const officeLabel = bindingValue(binding?.officeLabel) || intent.role;
    const article = bindingValue(binding?.article);
    const startDate = normalizeWikidataDate(bindingValue(binding?.start));
    const url = holderId ? `https://www.wikidata.org/wiki/${holderId}` : holderUri;
    const description = [
        holderName && jurisdiction?.label ? `${holderName} is listed by Wikidata as current ${officeLabel} for ${jurisdiction.label}.` : '',
        startDate ? `Start date: ${startDate}.` : '',
        article ? `Wikipedia: ${article}` : ''
    ].filter(Boolean).join(' ');
    return {
        title: holderName ? `${holderName} - ${officeLabel}` : officeLabel,
        description: description || `Structured Wikidata claim for current ${intent.role} of ${jurisdiction?.label || intent.jurisdiction}.`,
        url,
        domain: getDomainFromUrl(url),
        source: 'Wikidata',
        sourceType: 'structured_reference',
        sourceLabel: 'Wikidata structured role claim',
        date: startDate,
        freshness: 'current_structured_claim',
        position: index + 1,
        trusted: true,
        qualitySignals: ['structured_entity_data', 'current_office_claim', 'trusted_source'],
        evidenceLevel: 'structured_claim',
        role: intent.role,
        jurisdiction: jurisdiction?.label || intent.jurisdiction,
        holderName,
        wikidataId: holderId,
        wikipediaUrl: article || '',
        startDate,
        query
    };
}

function scoreWikidataEntityCandidate(query, item, index) {
    const q = String(query || '').toLowerCase();
    const label = String(item?.label || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    let score = Math.max(0, 20 - index);
    if (label === q) score += 30;
    if (label.includes(q) || q.includes(label)) score += 12;
    if (/\b(country|sovereign state|state|province|city|municipality|administrative territorial entity|federal state)\b/.test(description)) {
        score += 10;
    }
    if (/\b(disambiguation|family name|given name|film|song|album|book)\b/.test(description)) {
        score -= 15;
    }
    return score;
}

function bindingValue(binding) {
    return String(binding?.value || '').trim();
}

function extractWikidataId(value) {
    const match = String(value || '').match(/\bQ\d+\b/);
    return match ? match[0] : '';
}

function normalizeWikidataDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : raw;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSparqlString(value) {
    return String(value || '').toLowerCase().replace(/["\\]/g, '\\$&');
}

function normalizeRedditItem(item, query, index) {
    const permalink = String(item?.permalink || '').trim();
    const url = permalink
        ? `https://www.reddit.com${permalink}`
        : String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    const createdUtc = Number(item?.created_utc);
    const date = Number.isFinite(createdUtc) && createdUtc > 0
        ? new Date(createdUtc * 1000).toISOString()
        : '';
    const subreddit = String(item?.subreddit_name_prefixed || item?.subreddit || '').trim();
    return {
        title: String(item?.title || '').replace(/\s+/g, ' ').trim(),
        description: [
            subreddit ? `Community discussion: ${subreddit}` : 'Community discussion on Reddit.',
            Number.isFinite(Number(item?.score)) ? `Score: ${Number(item.score)}` : '',
            Number.isFinite(Number(item?.num_comments)) ? `Comments: ${Number(item.num_comments)}` : ''
        ].filter(Boolean).join(' | '),
        url,
        domain,
        source: subreddit || 'Reddit',
        sourceType: 'community_discussion',
        sourceLabel: subreddit ? `${subreddit} on Reddit` : 'Reddit',
        date,
        freshness: date ? 'community_dated' : 'community',
        position: index + 1,
        trusted: false,
        qualitySignals: ['public_discussion', 'community_source'],
        query
    };
}

function buildReferenceLookupResults(query, offset = 0) {
    const cleanQuery = normalizeSearchQuery(query);
    if (!cleanQuery) return [];
    const encoded = encodeURIComponent(cleanQuery);
    return [
        {
            title: `Britannica search: ${cleanQuery}`,
            description: 'Reference lookup on Britannica. Use to cross-check encyclopedia-style background.',
            url: `${BRITANNICA_SEARCH_URL}?query=${encoded}`,
            source: 'Britannica',
            sourceType: 'reference_lookup',
            sourceLabel: 'Britannica',
            qualitySignals: ['reference_lookup', 'encyclopedia_cross_check']
        },
        {
            title: `archive.today search: ${cleanQuery}`,
            description: 'Archive lookup for saved snapshots. Useful when a source page changed or disappeared.',
            url: `${ARCHIVE_TODAY_SEARCH_URL}?q=${encoded}`,
            source: 'archive.today',
            sourceType: 'archive_lookup',
            sourceLabel: 'archive.today',
            qualitySignals: ['archive_lookup', 'snapshot_cross_check']
        }
    ].map((item, index) => ({
        ...item,
        domain: getDomainFromUrl(item.url),
        date: '',
        freshness: 'lookup',
        position: offset + index + 1,
        trusted: item.source === 'Britannica',
        query: cleanQuery
    }));
}

async function normalizeOfficialShortcut(item, query, index) {
    const domain = getDomainFromUrl(item.url);
    const exactShortcutMatch = Boolean(item.pattern?.test?.(query));
    const page = await fetchOfficialPageContent(item.url, query).catch(() => null);
    return {
        title: page?.title || item.label,
        description: page?.description || `Official source for ${item.label.replace(/\s+official$/i, '')} updates and primary information.`,
        url: item.url,
        domain,
        source: item.label,
        sourceType: 'official_source',
        sourceLabel: item.label,
        date: '',
        freshness: page?.fetched ? 'official_page_fetched' : 'official_homepage_unverified',
        position: index + 1,
        trusted: true,
        pageFetched: Boolean(page?.fetched),
        exactShortcutMatch,
        evidenceLevel: page?.fetched ? 'official_page' : 'unverified_link',
        qualitySignals: ['official_source', 'trusted_domain', page?.fetched ? 'page_fetched' : 'page_not_fetched', page?.extractor].filter(Boolean),
        query
    };
}

async function fetchOfficialPageContent(url, query = '') {
    const crawled = await fetchOfficialPageContentWithCrawl4Ai(url, query).catch(() => null);
    if (crawled) return crawled;

    const response = await fetchWithTimeout(url, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'User-Agent': 'JARVISAssistant/1.0 public-source-search'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    const html = await response.text();
    const title = extractHtmlTitle(html) || getDomainFromUrl(url) || 'Official source';
    const description = extractHtmlDescription(html) || extractReadableHtmlText(html).slice(0, 320);
    if (!description || description.length < 20) return null;
    return {
        fetched: true,
        title: title.slice(0, 220),
        description: description.replace(/\s+/g, ' ').trim().slice(0, 420),
        extractor: 'html_fetched'
    };
}

async function fetchOfficialPageContentWithCrawl4Ai(url, query = '') {
    if (!hasCrawl4AiConfig()) return null;
    const result = await extractWithCrawl4Ai({
        url,
        query,
        textLimit: 4000,
        timeoutMs: PUBLIC_SOURCE_TIMEOUT_MS,
        respectRobots: true
    });
    const title = String(result?.title || getDomainFromUrl(url) || 'Official source').replace(/\s+/g, ' ').trim();
    const description = String(result?.description || result?.text || result?.markdown || '')
        .replace(/[#*_>`~\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!description || description.length < 20) return null;
    return {
        fetched: true,
        title: title.slice(0, 220),
        description: description.slice(0, 420),
        extractor: 'crawl4ai_extracted'
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
    const directAnswer = buildSourceDerivedAnswer(results, metadata);
    return {
        results,
        answer: directAnswer.answer || undefined,
        answerProvider: directAnswer.provider || undefined,
        distinctDomains,
        trustedCount,
        sourceCount: results.length,
        answerEvidenceCount: results.filter(isAnswerEvidenceResult).length,
        distinctDomainCount: distinctDomains.length,
        provider: metadata.provider || 'public_sources',
        publicSourceCount: Number(metadata.publicSourceCount) || 0,
        geminiEnhanced: Boolean(metadata.geminiEnhanced),
        warnings: Array.from(new Set((metadata.warnings || []).filter(Boolean))),
        refreshed: Boolean(metadata.refreshed)
    };
}

function buildSourceDerivedAnswer(results, metadata = {}) {
    const list = Array.isArray(results) ? results : [];
    const query = String(metadata.query || list.find(item => item?.query)?.query || '').trim();
    const roleIntent = parseGovernmentRoleQuery(query);
    const structuredRole = list
        .find(item => item?.evidenceLevel === 'structured_claim' && item?.holderName && item?.role && item?.jurisdiction && item?.url);
    if (structuredRole) {
        const holder = String(structuredRole.holderName || '').trim();
        const role = String(structuredRole.role || '').trim();
        const jurisdiction = String(structuredRole.jurisdiction || '').trim();
        const url = String(structuredRole.url || '').trim();
        if (holder && role && jurisdiction && url) {
            const startDate = String(structuredRole.startDate || '').trim();
            const startText = startDate ? ` Start date: ${startDate}.` : '';
            return {
                answer: `${holder} is listed by Wikidata as current ${role} for ${jurisdiction}.${startText}`,
                provider: 'wikidata_structured_claim'
            };
        }
    }
    if (roleIntent) return {};

    const top = list.find(isAnswerEvidenceResult);
    if (!top) return {};
    const sourceType = String(top.sourceType || '').trim();
    const title = String(top.title || '').replace(/\s+/g, ' ').trim();
    const description = String(top.description || '').replace(/\s+/g, ' ').trim();
    const sourceLabel = String(top.sourceLabel || top.source || top.domain || '').replace(/\s+/g, ' ').trim();
    if (!title && !description) return {};

    if (sourceType === 'free_weather') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'open_meteo_source');
    }
    if (sourceType === 'free_crypto_price') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'coingecko_source');
    }
    if (sourceType === 'free_disaster_event') {
        const date = String(top.date || '').trim();
        return sourceAnswer(`${title}${date ? ` (${date.slice(0, 10)})` : ''}${description ? `: ${description}` : ''}`, 'nasa_eonet_source');
    }
    if (sourceType === 'free_reference' || sourceType === 'free_place_data') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'public_place_source');
    }
    if (sourceType === 'free_sports_reference') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'sports_reference_source');
    }
    if (sourceType === 'cached_latest') {
        return sourceAnswer(`${title}${sourceLabel ? ` (${sourceLabel})` : ''}${description ? `: ${description}` : ''}`, 'latest_cache_source');
    }
    if (/^(official_source|trusted_news|public_news|encyclopedia|structured_reference)$/.test(sourceType)) {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'public_source_result');
    }
    return {};
}

function sourceAnswer(text, provider) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return {};
    return {
        answer: clean.endsWith('.') ? clean : `${clean}.`,
        provider
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
    return rankSources(query, results);
}

export function rankSources(query, results) {
    const terms = tokenize(query);
    return [...(Array.isArray(results) ? results : [])].sort((a, b) => scoreSearchResult(b, terms) - scoreSearchResult(a, terms));
}

function scoreSearchResult(item, terms) {
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    const domain = String(item?.domain || '').toLowerCase();
    let score = 0;
    if (item?.evidenceLevel === 'structured_claim') score += 45;
    if (item?.sourceType === 'official_source') score += 30;
    if (item?.trusted) score += 12;
    if (item?.sourceType === 'trusted_news') score += 8;
    if (item?.sourceType === 'encyclopedia') score += 4;
    if (item?.sourceType === 'structured_reference') score += 3;
    if (item?.sourceType === 'community_discussion') score -= 6;
    if (item?.sourceType === 'reference_lookup') score -= 12;
    if (item?.sourceType === 'archive_lookup') score -= 16;
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
    } else if (!results.some(isAnswerEvidenceResult)) {
        warnings.push('Only lookup or discussion links were found; no answer-bearing public source was available.');
    } else if (results.length < 3) {
        warnings.push('Limited public-source coverage; results may be incomplete.');
    }
    if (!results.some(item => item.sourceType === 'official_source' || item.trusted)) {
        warnings.push('No trusted or official source was found in the public-source result set.');
    }
    return Array.from(new Set(warnings.filter(Boolean)));
}

function isAnswerEvidenceResult(item) {
    return isValidCitationSource(item, item?.query || '');
}

export function isValidCitationSource(source, query = '') {
    const item = source || {};
    const title = String(item.title || '').trim();
    const url = String(item.url || '').trim();
    const description = String(item.description || '').trim();
    const sourceType = String(item.sourceType || '').trim();
    const domain = String(item.domain || getDomainFromUrl(url)).toLowerCase();
    const combined = `${title} ${description} ${url}`.toLowerCase();
    if (!title || !url) return false;
    if (!sourceType || LOOKUP_ONLY_SOURCE_TYPES.has(sourceType)) return false;
    if (!description || description.length < 20) return false;
    if (/search:|webcache|cache\.google|\/search(?:[/?#]|$)|[?&]q=/.test(combined)) return false;
    if (/archive\.(today|ph|is)|webcache/i.test(domain)) return false;
    if (sourceType === 'official_source' && !item.pageFetched) return false;
    if (item.evidenceLevel === 'structured_claim') return true;
    if (sourceType === 'official_source') return Boolean(item.exactShortcutMatch) || isRelatedToQuery(query, item);
    if (/^(encyclopedia|structured_reference|trusted_news|public_news|cached_latest|free_)/.test(sourceType)) {
        return isRelatedToQuery(query, item);
    }
    return false;
}

function hasCrawl4AiConfig() {
    return Boolean(String(process.env.CRAWL4AI_URL || '').trim());
}

function isRelatedToQuery(query, item) {
    const terms = tokenize(query).filter(term => !COMMON_QUERY_TERMS.has(term));
    if (!terms.length) return true;
    const hay = `${item?.title || ''} ${item?.description || ''} ${item?.sourceLabel || ''}`.toLowerCase();
    return terms.some(term => hay.includes(term));
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

function extractHtmlTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return stripHtml(match?.[1] || '').trim();
}

function extractHtmlDescription(html) {
    const raw = String(html || '');
    const meta = raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
        raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
    return stripHtml(meta?.[1] || '').trim();
}

function extractReadableHtmlText(html) {
    return stripHtml(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' '));
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
    searchWikidata,
    searchReddit,
    searchGovernmentRole,
    parseGovernmentRoleQuery,
    normalizeGovernmentRoleBindings,
    isValidCitationSource,
    rankSources,
    searchPublicSources,
    searchWikipedia,
    buildGeminiSearchPlan,
    enhanceResultsWithGemini,
    isTrustedLiveSource,
    routeMessage,
    runCachedLatestSearch
};
