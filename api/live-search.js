import { SOURCE_POLICIES, detectQueryDomain } from './_lib/search-domain-policy.js';

const SEARCH_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than',
    'do', 'does', 'did', 'can', 'could', 'would', 'will', 'should',
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
    'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
    'we', 'our', 'ours', 'they', 'their', 'theirs', 'he', 'she', 'it',
    'please', 'kindly', 'just', 'about', 'on', 'for', 'to', 'of', 'in',
    'at', 'by', 'with', 'from', 'into', 'as', 'per', 'tell', 'show',
    'give', 'find', 'search', 'look', 'lookup', 'check', 'know', 'explain',
    'describe', 'summarize', 'summary', 'information', 'info',
    'provide', 'include', 'exact', 'please', 'sources', 'source', 'link', 'links',
    'bullet', 'bullets', 'list', 'listed', 'showing'
]);
const LEADING_QUERY_PATTERNS = [
    /^(?:can|could|would|will|do|does|did)\s+you\s+/i,
    /^(?:what|which|who|when|where|why|how)\s+(?:is|are|was|were|do|does|did|can|could|would|will|should|has|have|had)\s+/i,
    /^(?:what|which|who|when|where|why|how)\s+/i,
    /^(?:tell|show|give|find|search|look\s+up|check)\s+me\s+/i,
    /^(?:tell|show|give|find|search|look\s+up|check)\s+/i,
    /^(?:please|kindly)\s+/i
];

const TRAILING_QUERY_PATTERNS = [
    /\b(?:please|for me|per se)\b/gi
];

const PROMPT_DECORATOR_PATTERNS = [
    /\b(?:give|provide|show|include)\s+(?:me\s+)?(?:the\s+)?/gi,
    /\b(?:with|and)\s+\d+\s+(?:source\s+)?links?\b/gi,
    /\b\d+\s+(?:source\s+)?links?\b/gi,
    /\b(?:source|sources)\s+links?\b/gi,
    /\b(?:in|as)\s+(?:short\s+)?bullet\s+points?\b/gi,
    /\b(?:in|as)\s+(?:a\s+)?(?:single\s+)?line\b/gi,
    /\b(?:exact|accurate)\s+(?:date|time|score|venue|teams?)\b/gi,
    /\b(?:only|just)\s+(?:answer|result|score)\b/gi
];

const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const DEFAULT_FETCH_RETRIES = 1;
const PAGE_CRAWL_TIMEOUT_MS = 5000;
const PAGE_CRAWL_MAX_BYTES = 700_000;
const PAGE_CRAWL_MAX_RESULTS = 4;

export async function searchWeb(query, maxResults = 8) {
    const searchQuery = extractSearchTopic(query) || String(query || '').trim();
    const normalizedMax = Math.min(Math.max(Number(maxResults || 8), 1), 10);
    const serperKey = getSerperApiKey();
    const attempts = [];

    if (serperKey) {
        attempts.push(() => searchWithSerper(searchQuery, normalizedMax, serperKey));
    }
    attempts.push(() => searchWithDuckDuckGoHtml(searchQuery, normalizedMax));
    attempts.push(() => searchWithDuckDuckGo(searchQuery, normalizedMax));
    attempts.push(() => searchWithWikipedia(searchQuery, normalizedMax));
    if (isLikelyNewsQuery(query)) {
        attempts.push(() => searchWithGoogleNewsRss(searchQuery, normalizedMax));
    }

    const merged = [];
    const seen = new Set();
    for (const run of attempts) {
        try {
            const current = await run();
            if (!Array.isArray(current) || !current.length) continue;
            for (const item of current) {
                const url = String(item?.url || '').trim();
                if (!url || seen.has(url)) continue;
                seen.add(url);
                merged.push(item);
            }
        } catch (e) {
            // Try next provider.
        }
    }

    if (!merged.length) return [];
    return rerankResults(merged, query).slice(0, normalizedMax);
}

export async function runVerifiedWebSearch(queries, options = {}) {
    const maxResultsPerQuery = Math.min(Math.max(Number(options.maxResultsPerQuery || 6), 1), 10);
    const limit = Math.min(Math.max(Number(options.limit || 10), 1), 15);
    const includePageExtract = Boolean(options.includePageExtract);
    const queryList = Array.isArray(queries) ? queries.filter(Boolean) : [];
    const resultSets = await Promise.all(queryList.map(q => searchWeb(q, maxResultsPerQuery)));

    const merged = [];
    const seen = new Set();
    for (const item of resultSets.flat()) {
        const url = String(item?.url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push(item);
    }

    const rerankedBase = rerankResults(merged, queryList.join(' ')).slice(0, limit);
    const reranked = includePageExtract
        ? await enrichResultsWithPageExtract(rerankedBase, {
            maxResultsToCrawl: Math.min(PAGE_CRAWL_MAX_RESULTS, limit)
        })
        : rerankedBase;
    const distinctDomains = Array.from(new Set(reranked.map(item => getDomainFromUrl(item.url)).filter(Boolean)));
    const providerBreakdown = countByProvider(reranked);
    return {
        results: reranked,
        distinctDomains,
        trustedCount: reranked.filter(item => isTrustedLiveSource(item.url)).length,
        providerBreakdown,
        serperConfigured: Boolean(getSerperApiKey())
    };
}

export function rerankResults(results, query) {
    const queryTerms = tokenize(query);
    const queryText = String(query || '').toLowerCase();
    const wantsRecency = /\b(latest|recent|current|today|right now|as of now|breaking|update|news|headlines?)\b/.test(queryText);
    const queryDomain = detectQueryDomain(queryText);
    const scored = [...(Array.isArray(results) ? results : [])]
        .map((item, index) => {
            const title = String(item?.title || '');
            const description = String(item?.description || '');
            const haystack = `${title} ${description}`.toLowerCase();
            const overlap = queryTerms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
            const trustedBoost = scoreSourcePolicy(item?.url, queryDomain);
            const titleBoost = queryTerms.reduce((acc, term) => acc + (title.toLowerCase().includes(term) ? 1 : 0), 0);
            const recencyBoost = wantsRecency ? scoreRecency(`${title} ${description} ${item?.url || ''}`) : 0;
            const providerBoost = scoreProvider(item?.provider);
            return {
                ...item,
                __score: trustedBoost + overlap + titleBoost + recencyBoost + providerBoost - (index * 0.01)
            };
        })
        .sort((a, b) => b.__score - a.__score);

    return diversifyResults(scored).map(({ __score, ...item }) => item);
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
        return '';
    }
}

export function isTrustedLiveSource(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return false;
    return Object.values(SOURCE_POLICIES).some(policy => domainMatches(domain, policy.trustedDomains));
}

export function extractSearchTopic(text) {
    let cleaned = String(text || '').trim();
    if (!cleaned) return '';

    for (const pattern of LEADING_QUERY_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    for (const pattern of TRAILING_QUERY_PATTERNS) {
        cleaned = cleaned.replace(pattern, ' ');
    }
    for (const pattern of PROMPT_DECORATOR_PATTERNS) {
        cleaned = cleaned.replace(pattern, ' ');
    }

    cleaned = cleaned
        .replace(/[?!]/g, ' ')
        // Keep 4-digit years (e.g., 2026) so time-specific queries stay precise.
        .replace(/\b\d+\b/g, (digits) => (/^(19|20)\d{2}$/.test(digits) ? digits : ' '))
        .replace(/\s+/g, ' ')
        .trim();

    const meaningfulTokens = cleaned
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(token => token && !SEARCH_STOP_WORDS.has(token));

    return meaningfulTokens.join(' ').trim() || cleaned;
}

function tokenize(text) {
    return extractSearchTopic(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 1 && !SEARCH_STOP_WORDS.has(token))
        .slice(0, 12);
}

function isLikelyNewsQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(news|headlines?|breaking|current events?|latest|recent|current|today|right now|situation|conflict|war|attack|ceasefire|talks|middle[\s-]?east|israel|gaza|iran|ukraine|russia|syria|lebanon|palestine|oil|winner|won|champion|final result|score|scores|live score|stats|standings|points table|rankings?|record|qualified|eliminated|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup|policy update|election result|model release|openai|anthropic|gemini|llama|nasa|isro|esa|jaxa)\b/.test(t);
}

function scoreRecency(text) {
    const t = String(text || '').toLowerCase();
    let score = 0;
    if (/\b(live|breaking|just in|minutes? ago|hours? ago)\b/.test(t)) score += 3;
    if (/\b(today|latest|current|recent|updated?)\b/.test(t)) score += 2;
    if (/\b(yesterday)\b/.test(t)) score += 1;
    if (/\b(2026)\b/.test(t)) score += 2;
    if (/\b(2025)\b/.test(t)) score += 1;
    return score;
}

function domainMatches(domain, list) {
    return Array.isArray(list) && list.some(d => domain === d || domain.endsWith(`.${d}`));
}

function scoreSourcePolicy(url, domain) {
    const host = getDomainFromUrl(url);
    const policy = SOURCE_POLICIES[domain] || SOURCE_POLICIES.general;
    if (!host) return 0;
    if (domainMatches(host, policy.preferredDomains)) return 7;
    if (domainMatches(host, policy.trustedDomains)) return 4;
    if (domainMatches(host, SOURCE_POLICIES.general.trustedDomains)) return 2;
    return 0;
}

function diversifyResults(results) {
    const out = [];
    const publisherCounts = new Map();
    for (const item of results) {
        const publisher = getPublisherKey(item?.url);
        const count = publisherCounts.get(publisher) || 0;
        if (count >= 2) continue;
        publisherCounts.set(publisher, count + 1);
        out.push(item);
    }

    if (out.length >= Math.min(results.length, 3)) {
        return out;
    }
    return results;
}

function getPublisherKey(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return '';
    const parts = domain.split('.');
    if (parts.length <= 2) return domain;
    return parts.slice(-2).join('.');
}

function sanitizeExternalUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

async function searchWithSerper(query, maxResults, apiKey) {
    const response = await fetchWithTimeoutRetry('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey
        },
        body: JSON.stringify({ q: query, num: maxResults })
    });
    if (!response.ok) return [];
    const data = await response.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    return organic.slice(0, maxResults).map(item => ({
        title: item?.title || 'Untitled',
        url: sanitizeExternalUrl(item?.link || ''),
        description: item?.snippet || '',
        provider: 'serper'
    })).filter(item => item.url);
}

async function searchWithDuckDuckGo(query, maxResults) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetchWithTimeoutRetry(url);
    if (!response.ok) return [];
    const data = await response.json();
    const out = [];

    const pushTopic = (topic) => {
        if (!topic || out.length >= maxResults) return;
        const safeUrl = sanitizeExternalUrl(topic.FirstURL);
        if (safeUrl && topic.Text) {
            out.push({
                title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
                url: safeUrl,
                description: topic.Text,
                provider: 'duckduckgo-api'
            });
        }
    };

    const related = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    for (const item of related) {
        if (item?.Topics && Array.isArray(item.Topics)) {
            for (const sub of item.Topics) pushTopic(sub);
        } else {
            pushTopic(item);
        }
        if (out.length >= maxResults) break;
    }
    return out.slice(0, maxResults);
}

async function searchWithDuckDuckGoHtml(query, maxResults) {
    const response = await fetchWithTimeoutRetry('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `q=${encodeURIComponent(query)}`
    });
    if (!response.ok) return [];
    const html = await response.text();
    const out = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(html)) && out.length < maxResults) {
        const rawHref = decodeHtmlEntities(String(match[1] || '').trim());
        const resolvedHref = normalizeDuckDuckGoResultUrl(rawHref);
        const url = sanitizeExternalUrl(resolvedHref);
        const title = decodeHtmlEntities(stripTags(String(match[2] || '').trim()));
        if (!url || !title) continue;
        out.push({ title, url, description: title, provider: 'duckduckgo-html' });
    }
    return out;
}

function normalizeDuckDuckGoResultUrl(href) {
    let candidate = String(href || '').trim();
    if (!candidate) return '';

    if (candidate.startsWith('//')) {
        candidate = `https:${candidate}`;
    } else if (candidate.startsWith('/')) {
        candidate = `https://duckduckgo.com${candidate}`;
    }

    try {
        const parsed = new URL(candidate);
        const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        const isDuckRedirect = host === 'duckduckgo.com' && parsed.pathname.startsWith('/l/');
        if (isDuckRedirect) {
            const encodedTarget = parsed.searchParams.get('uddg');
            if (encodedTarget) {
                return decodeURIComponent(encodedTarget);
            }
        }
    } catch (error) {
        return '';
    }

    return candidate;
}

async function searchWithWikipedia(query, maxResults) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${Math.min(maxResults, 10)}&format=json`;
    const response = await fetchWithTimeoutRetry(url);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
    const titleOrder = hits.slice(0, maxResults).map(item => String(item?.title || '').trim()).filter(Boolean);
    const thumbByTitle = await fetchWikipediaThumbnailsByTitle(titleOrder);

    return hits.slice(0, maxResults).map((item) => {
        const title = String(item?.title || '').trim();
        const snippet = decodeHtmlEntities(stripTags(String(item?.snippet || '').trim()));
        const thumb = thumbByTitle.get(title);
        return {
            title: title || 'Wikipedia result',
            url: thumb?.sourceUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
            description: snippet || title,
            thumbnailUrl: thumb?.thumbnailUrl || '',
            imageUrl: thumb?.thumbnailUrl || '',
            provider: 'wikipedia'
        };
    }).filter(item => item.url);
}

async function fetchWikipediaThumbnailsByTitle(titles) {
    const list = Array.isArray(titles) ? titles.map(t => String(t || '').trim()).filter(Boolean) : [];
    if (!list.length) return new Map();
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages|info&inprop=url&pithumbsize=640&titles=${encodeURIComponent(list.join('|'))}&format=json`;
    try {
        const response = await fetchWithTimeoutRetry(url);
        if (!response.ok) return new Map();
        const data = await response.json();
        const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
        const out = new Map();
        for (const page of pages) {
            const title = String(page?.title || '').trim();
            if (!title) continue;
            out.set(title, {
                thumbnailUrl: String(page?.thumbnail?.source || '').trim(),
                sourceUrl: String(page?.fullurl || '').trim()
            });
        }
        return out;
    } catch (_) {
        return new Map();
    }
}

async function searchWithGoogleNewsRss(query, maxResults) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetchWithTimeoutRetry(url, {
        headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml'
        }
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const out = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) && out.length < maxResults) {
        const block = match[1];
        const title = cleanGoogleNewsTitle(decodeXml(getTag(block, 'title')));
        const urlValue = sanitizeExternalUrl(decodeXml(getTag(block, 'link')));
        const description = decodeXml(stripTags(getTag(block, 'description')));
        if (!title || !urlValue) continue;
        out.push({
            title,
            url: urlValue,
            description: description || title,
            provider: 'google-news-rss'
        });
    }
    return out;
}

function getTag(block, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    return regex.exec(block)?.[1] || '';
}

function stripTags(input) {
    return String(input || '').replace(/<[^>]*>/g, ' ');
}

function decodeXml(input) {
    return String(input || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeHtmlEntities(input) {
    return String(input || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanGoogleNewsTitle(title) {
    return String(title || '').replace(/\s+-\s+[^-]+$/, '').trim();
}

function getSerperApiKey() {
    return String(
        process.env.SERPER_API_KEY ||
        process.env.SERPER_KEY ||
        process.env.SERPER_API ||
        ''
    ).trim();
}

function scoreProvider(provider) {
    const p = String(provider || '').toLowerCase();
    if (p === 'serper') return 2.5;
    if (p === 'google-news-rss') return 1.25;
    return 0;
}

function countByProvider(results) {
    const out = {};
    for (const item of Array.isArray(results) ? results : []) {
        const key = String(item?.provider || 'unknown').trim() || 'unknown';
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

async function fetchWithTimeoutRetry(url, init = {}, options = {}) {
    const timeoutMs = clampInt(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS, 1000, 20_000);
    const retries = clampInt(options.retries, DEFAULT_FETCH_RETRIES, 0, 3);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal
            });
            clearTimeout(timer);
            return response;
        } catch (error) {
            clearTimeout(timer);
            lastError = error;
            if (attempt >= retries) throw error;
        }
    }
    throw lastError || new Error('fetch_failed');
}

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.round(n);
    if (i < min) return min;
    if (i > max) return max;
    return i;
}

async function enrichResultsWithPageExtract(results, options = {}) {
    const list = Array.isArray(results) ? results.slice() : [];
    if (!list.length) return list;
    const maxResultsToCrawl = clampInt(options.maxResultsToCrawl, PAGE_CRAWL_MAX_RESULTS, 1, 8);
    const crawlTargets = list
        .map((item, index) => ({ item, index }))
        .filter(entry => shouldCrawlResultUrl(entry.item?.url))
        .slice(0, maxResultsToCrawl);

    if (!crawlTargets.length) return list;

    const crawled = await Promise.all(
        crawlTargets.map(async (entry) => {
            const extract = await fetchAndExtractPage(entry.item.url);
            return { index: entry.index, extract };
        })
    );

    for (const hit of crawled) {
        if (!hit?.extract) continue;
        const target = list[hit.index];
        if (!target) continue;
        target.pageExtract = hit.extract.excerpt || '';
        target.pageTitle = hit.extract.pageTitle || target.title || '';
        target.keyEntities = Array.isArray(hit.extract.names) ? hit.extract.names : [];
        if (hit.extract.excerpt && (!target.description || target.description.length < 40)) {
            target.description = hit.extract.excerpt;
        }
    }

    return list;
}

function shouldCrawlResultUrl(url) {
    const safe = sanitizeExternalUrl(url);
    if (!safe) return false;
    const lower = safe.toLowerCase();
    if (/\.(pdf|zip|rar|7z|png|jpe?g|webp|gif|mp4|mp3|avi|mov)(\?|$)/.test(lower)) return false;
    return true;
}

async function fetchAndExtractPage(url) {
    try {
        const response = await fetchWithTimeoutRetry(url, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; UnifyAssistantBot/1.0; +https://example.local)'
            }
        }, {
            timeoutMs: PAGE_CRAWL_TIMEOUT_MS,
            retries: 0
        });
        if (!response.ok) return null;
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return null;

        const html = await readResponseTextWithLimit(response, PAGE_CRAWL_MAX_BYTES);
        if (!html) return null;
        const extracted = extractReadableContentFromHtml(html);
        if (!extracted.excerpt) return null;
        return extracted;
    } catch (_) {
        return null;
    }
}

async function readResponseTextWithLimit(response, maxBytes) {
    const reader = response?.body?.getReader ? response.body.getReader() : null;
    if (!reader) {
        const text = await response.text();
        return text.length > maxBytes ? text.slice(0, maxBytes) : text;
    }
    const decoder = new TextDecoder();
    let out = '';
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength || 0;
        if (total > maxBytes) break;
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

function extractReadableContentFromHtml(html) {
    const raw = String(html || '');
    if (!raw) return { pageTitle: '', excerpt: '', names: [] };

    const pageTitle = decodeHtmlEntities((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
    const h1 = decodeHtmlEntities(stripTags((raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').trim()));
    const metaDescription = decodeHtmlEntities(
        (raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)?.[1] || '').trim()
    );

    const bodyClean = raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
    const bodyText = decodeHtmlEntities(stripTags(bodyClean))
        .replace(/\s+/g, ' ')
        .trim();

    const excerptPieces = [h1, metaDescription, bodyText.slice(0, 1200)]
        .map(v => String(v || '').trim())
        .filter(Boolean);
    const excerpt = excerptPieces.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const names = extractNameCandidates(`${h1} ${metaDescription} ${bodyText.slice(0, 2500)}`);
    return {
        pageTitle: pageTitle || h1 || '',
        excerpt,
        names
    };
}

function extractNameCandidates(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    const blocked = new Set(['The', 'This', 'That', 'From', 'With', 'News', 'Live', 'Update']);
    const out = [];
    const seen = new Set();
    let match;
    while ((match = pattern.exec(clean)) && out.length < 12) {
        const value = String(match[1] || '').trim();
        if (!value || blocked.has(value)) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}


