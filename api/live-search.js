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

export async function searchWeb(query, maxResults = 8) {
    const normalizedMax = Math.min(Math.max(Number(maxResults || 8), 1), 10);
    const serperKey = process.env.SERPER_API_KEY;
    const braveKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
    const attempts = [];

    if (serperKey) {
        attempts.push(() => searchWithSerper(query, normalizedMax, serperKey));
    }
    if (braveKey) {
        attempts.push(() => searchWithBrave(query, normalizedMax, braveKey));
    }
    attempts.push(() => searchWithDuckDuckGo(query, normalizedMax));
    attempts.push(() => searchWithDuckDuckGoHtml(query, normalizedMax));

    for (const run of attempts) {
        try {
            const current = await run();
            if (Array.isArray(current) && current.length) return current;
        } catch (e) {
            // Try next provider.
        }
    }
    return [];
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
    return [...(Array.isArray(results) ? results : [])]
        .map((item, index) => {
            const haystack = `${item?.title || ''} ${item?.description || ''}`.toLowerCase();
            const overlap = queryTerms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
            const trustedBoost = isTrustedLiveSource(item?.url) ? 5 : 0;
            const titleBoost = queryTerms.reduce((acc, term) => acc + (String(item?.title || '').toLowerCase().includes(term) ? 1 : 0), 0);
            return {
                ...item,
                __score: trustedBoost + overlap + titleBoost - (index * 0.01)
            };
        })
        .sort((a, b) => b.__score - a.__score)
        .map(({ __score, ...item }) => item);
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

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 2)
        .slice(0, 12);
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

function stripTags(input) {
    return String(input || '').replace(/<[^>]*>/g, ' ');
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
