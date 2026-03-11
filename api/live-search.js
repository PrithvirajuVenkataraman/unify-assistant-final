const TRUSTED_DOMAINS = [
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'aljazeera.com',
    'npr.org',
    'cnbc.com',
    'bloomberg.com',
    'wsj.com',
    'ft.com',
    'nytimes.com',
    'theguardian.com',
    'economist.com',
    'ecb.europa.eu',
    'frankfurter.dev',
    'xe.com',
    'oanda.com',
    'x-rates.com',
    'investing.com',
    'marketwatch.com',
    'coindesk.com',
    'cointelegraph.com'
];

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
    'describe', 'summarize', 'summary', 'information', 'info'
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

export async function searchWeb(query, maxResults = 8) {
    const searchQuery = extractSearchTopic(query) || String(query || '').trim();
    const normalizedMax = Math.min(Math.max(Number(maxResults || 8), 1), 10);
    const serperKey = process.env.SERPER_API_KEY;
    const braveKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
    const attempts = [];

    if (serperKey) {
        attempts.push(() => searchWithSerper(searchQuery, normalizedMax, serperKey));
    }
    if (braveKey) {
        attempts.push(() => searchWithBrave(searchQuery, normalizedMax, braveKey));
    }
    attempts.push(() => searchWithDuckDuckGoHtml(searchQuery, normalizedMax));
    attempts.push(() => searchWithDuckDuckGo(searchQuery, normalizedMax));
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

    const reranked = rerankResults(merged, queryList.join(' ')).slice(0, limit);
    const distinctDomains = Array.from(new Set(reranked.map(item => getDomainFromUrl(item.url)).filter(Boolean)));
    return {
        results: reranked,
        distinctDomains,
        trustedCount: reranked.filter(item => isTrustedLiveSource(item.url)).length
    };
}

export function rerankResults(results, query) {
    const queryTerms = tokenize(query);
    const queryText = String(query || '').toLowerCase();
    const wantsRecency = /\b(latest|recent|current|today|right now|as of now|breaking|update|news|headlines?)\b/.test(queryText);
    const scored = [...(Array.isArray(results) ? results : [])]
        .map((item, index) => {
            const title = String(item?.title || '');
            const description = String(item?.description || '');
            const haystack = `${title} ${description}`.toLowerCase();
            const overlap = queryTerms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
            const trustedBoost = isTrustedLiveSource(item?.url) ? 5 : 0;
            const titleBoost = queryTerms.reduce((acc, term) => acc + (title.toLowerCase().includes(term) ? 1 : 0), 0);
            const recencyBoost = wantsRecency ? scoreRecency(`${title} ${description} ${item?.url || ''}`) : 0;
            return {
                ...item,
                __score: trustedBoost + overlap + titleBoost + recencyBoost - (index * 0.01)
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
    return TRUSTED_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
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

    cleaned = cleaned
        .replace(/[?!]/g, ' ')
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
    return /\b(news|headlines?|breaking|current events?|latest|recent|current|today|right now|situation|conflict|war|attack|ceasefire|talks|middle[\s-]?east|israel|gaza|iran|ukraine|russia|syria|lebanon|palestine|oil)\b/.test(t);
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

async function searchWithSerper(query, maxResults, apiKey) {
    const response = await fetch('https://google.serper.dev/search', {
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
        url: item?.link || '',
        description: item?.snippet || ''
    })).filter(item => item.url);
}

async function searchWithBrave(query, maxResults, apiKey) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': apiKey
        }
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data?.web?.results) ? data.web.results : [];
    return list.slice(0, maxResults).map(item => ({
        title: item?.title || 'Untitled',
        url: item?.url || '',
        description: item?.description || ''
    })).filter(item => item.url);
}

async function searchWithDuckDuckGo(query, maxResults) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const out = [];

    const pushTopic = (topic) => {
        if (!topic || out.length >= maxResults) return;
        if (topic.FirstURL && topic.Text) {
            out.push({
                title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
                url: topic.FirstURL,
                description: topic.Text
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
    const response = await fetch('https://html.duckduckgo.com/html/', {
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
        const url = decodeHtmlEntities(String(match[1] || '').trim());
        const title = decodeHtmlEntities(stripTags(String(match[2] || '').trim()));
        if (!/^https?:\/\//i.test(url) || !title) continue;
        out.push({ title, url, description: title });
    }
    return out;
}

async function searchWithGoogleNewsRss(query, maxResults) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
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
        const urlValue = decodeXml(getTag(block, 'link'));
        const description = decodeXml(stripTags(getTag(block, 'description')));
        if (!title || !urlValue) continue;
        out.push({
            title,
            url: urlValue,
            description: description || title
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
