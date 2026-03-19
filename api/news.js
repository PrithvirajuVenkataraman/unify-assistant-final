import { extractSearchTopic } from './live-search.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const query = String(req.body?.query || '').trim();
        const category = String(req.body?.category || '').trim();
        const city = String(req.body?.city || '').trim();
        const countryCode = String(req.body?.countryCode || '').trim();
        if ([query, category, city, countryCode].some(value => value.length > 500)) {
            return res.status(413).json({ success: false, error: 'news query is too long', articles: [] });
        }

        const topic = normalizeTopic(query || category || (city ? `${city} news` : 'latest news'));
        const queries = [
            topic,
            `latest ${topic}`,
            `${topic} Reuters OR AP OR BBC OR Al Jazeera`
        ];
        if (!query && city) queries.push(`${city} breaking news`);
        if (!query && countryCode && countryCode !== 'DEFAULT') queries.push(`${countryCode} national news`);

        const settled = await Promise.allSettled([
            (async () => {
                return runVerifiedWebSearch(queries, {
                    maxResultsPerQuery: 6,
                    limit: 10
                });
            })(),
            (async () => {
                return fetchGoogleNewsRss(topic);
            })()
        ]);

        const verified = settled[0]?.status === 'fulfilled'
            ? settled[0].value
            : { results: [], distinctDomains: [], trustedCount: 0 };
        const rssArticles = settled[1]?.status === 'fulfilled'
            ? settled[1].value
            : [];

        if (rssArticles.length) {
            return res.status(200).json({
                success: true,
                verified: true,
                query: topic,
                sourceCount: rssArticles.length,
                distinctDomainCount: 1,
                trustedCount: rssArticles.length,
                articles: rssArticles
            });
        }

        if (!verified.results.length) {
            return res.status(200).json({
                success: true,
                verified: false,
                query: topic,
                sourceCount: 0,
                distinctDomainCount: 0,
                trustedCount: 0,
                articles: []
            });
        }

        return res.status(200).json({
            success: true,
            verified: true,
            query: topic,
            sourceCount: verified.results.length,
            distinctDomainCount: verified.distinctDomains.length,
            trustedCount: verified.trustedCount,
            articles: verified.results.map(item => ({
                title: item.title,
                url: item.url,
                description: item.description
            }))
        });
    } catch (error) {
        return res.status(200).json({
            success: false,
            error: 'news lookup failed',
            details: String(error?.message || error),
            query: String(req.body?.query || req.body?.category || '').trim(),
            articles: []
        });
    }
}

function normalizeTopic(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    return extractSearchTopic(raw) || raw;
}

async function fetchGoogleNewsRss(topic) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml'
        }
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) && items.length < 8) {
        const block = match[1];
        const title = decodeXml(getTag(block, 'title'));
        const link = decodeXml(getTag(block, 'link'));
        const description = decodeXml(stripHtml(getTag(block, 'description')));
        if (!title || !link) continue;
        items.push({
            title: cleanGoogleNewsTitle(title),
            url: link,
            description: description || title
        });
    }
    return items;
}

function getTag(block, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    return regex.exec(block)?.[1] || '';
}

function stripHtml(input) {
    return String(input || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

function cleanGoogleNewsTitle(title) {
    return String(title || '').replace(/\s+-\s+[^-]+$/, '').trim();
}

const TRUSTED_DOMAINS = [
    'isro.gov.in',
    'nasa.gov',
    'esa.int',
    'space.com',
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
    'economist.com'
];

async function runVerifiedWebSearch(queries, options = {}) {
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

async function searchWeb(query, maxResults = 8) {
    const searchQuery = normalizeTopic(query) || String(query || '').trim();
    const normalizedMax = Math.min(Math.max(Number(maxResults || 8), 1), 10);
    const serperKey = process.env.SERPER_API_KEY;
    const attempts = [];

    if (serperKey) {
        attempts.push(() => searchWithSerper(searchQuery, normalizedMax, serperKey));
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

function rerankResults(results, query) {
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

function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
        return '';
    }
}

function isTrustedLiveSource(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return false;
    return TRUSTED_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
}

function tokenize(text) {
    return normalizeTopic(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 1)
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
        url: sanitizeExternalUrl(item?.link || ''),
        description: item?.snippet || ''
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
        const safeUrl = sanitizeExternalUrl(topic.FirstURL);
        if (safeUrl && topic.Text) {
            out.push({
                title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
                url: safeUrl,
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
        const url = sanitizeExternalUrl(decodeHtmlEntities(String(match[1] || '').trim()));
        const title = decodeHtmlEntities(stripTags(String(match[2] || '').trim()));
        if (!url || !title) continue;
        out.push({ title, url, description: title }); 
    }
    return out;
}

