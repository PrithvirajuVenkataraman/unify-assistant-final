const SOURCE_POLICIES = {
    general: {
        trustedDomains: [
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
        ],
        preferredDomains: []
    },
    sports: {
        trustedDomains: [
            'espn.com',
            'espncricinfo.com',
            'cricbuzz.com',
            'icc-cricket.com',
            'fifa.com',
            'uefa.com',
            'nba.com',
            'nfl.com',
            'mlb.com',
            'nhl.com',
            'atptour.com',
            'wtatennis.com',
            'formula1.com',
            'motogp.com',
            'ufc.com',
            'olympics.com',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'icc-cricket.com',
            'espncricinfo.com',
            'cricbuzz.com',
            'fifa.com',
            'uefa.com',
            'nba.com',
            'nfl.com',
            'atptour.com',
            'wtatennis.com',
            'formula1.com',
            'ufc.com',
            'olympics.com'
        ]
    },
    politics: {
        trustedDomains: [
            'gov.in',
            'parliament.uk',
            'congress.gov',
            'eci.gov.in',
            'reuters.com',
            'apnews.com',
            'bbc.com',
            'bbc.co.uk',
            'aljazeera.com',
            'npr.org'
        ],
        preferredDomains: [
            'gov.in',
            'eci.gov.in',
            'parliament.uk',
            'congress.gov'
        ]
    },
    finance: {
        trustedDomains: [
            'ecb.europa.eu',
            'frankfurter.dev',
            'xe.com',
            'oanda.com',
            'x-rates.com',
            'investing.com',
            'marketwatch.com',
            'bloomberg.com',
            'wsj.com',
            'ft.com',
            'cnbc.com',
            'reuters.com',
            'nasdaq.com',
            'nyse.com',
            'nseindia.com',
            'bseindia.com',
            'spglobal.com',
            'wfe.org',
            'cmegroup.com',
            'lme.com',
            'kitco.com',
            'mcxindia.com',
            'iocl.com',
            'hindustanpetroleum.com',
            'bharatpetroleum.in',
            'eia.gov'
        ],
        preferredDomains: [
            'ecb.europa.eu',
            'frankfurter.dev',
            'xe.com',
            'oanda.com',
            'x-rates.com',
            'bloomberg.com',
            'nasdaq.com',
            'nyse.com',
            'nseindia.com',
            'bseindia.com',
            'kitco.com',
            'mcxindia.com',
            'iocl.com',
            'hindustanpetroleum.com',
            'bharatpetroleum.in'
        ]
    },
    space_science: {
        trustedDomains: [
            'nasa.gov',
            'isro.gov.in',
            'esa.int',
            'jaxa.jp',
            'spacex.com',
            'space.com',
            'scientificamerican.com',
            'nature.com',
            'science.org',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'isro.gov.in',
            'nasa.gov',
            'esa.int',
            'jaxa.jp',
            'spacex.com',
            'nature.com',
            'science.org'
        ]
    },
    tech: {
        trustedDomains: [
            'openai.com',
            'microsoft.com',
            'google.com',
            'nvidia.com',
            'amd.com',
            'ibm.com',
            'reuters.com',
            'apnews.com',
            'bloomberg.com',
            'cnbc.com'
        ],
        preferredDomains: [
            'openai.com',
            'microsoft.com',
            'google.com',
            'nvidia.com',
            'amd.com',
            'ibm.com'
        ]
    },
    entertainment: {
        trustedDomains: [
            'imdb.com',
            'wikipedia.org',
            'rottentomatoes.com',
            'metacritic.com',
            'netflix.com',
            'primevideo.com',
            'disneyplus.com',
            'hotstar.com',
            'zee5.com',
            'sonyliv.com',
            'reuters.com',
            'bbc.com'
        ],
        preferredDomains: [
            'imdb.com',
            'wikipedia.org',
            'rottentomatoes.com',
            'netflix.com',
            'primevideo.com',
            'disneyplus.com'
        ]
    }
};

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

export async function searchWeb(query, maxResults = 8) {
    const searchQuery = extractSearchTopic(query) || String(query || '').trim();
    const normalizedMax = Math.min(Math.max(Number(maxResults || 8), 1), 10);
    const serperKey = process.env.SERPER_API_KEY;
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
        .replace(/\b\d+\b/g, ' ')
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
    return /\b(news|headlines?|breaking|current events?|latest|recent|current|today|right now|situation|conflict|war|attack|ceasefire|talks|middle[\s-]?east|israel|gaza|iran|ukraine|russia|syria|lebanon|palestine|oil|winner|won|champion|final result|score|scores|live score|stats|standings|points table|rankings?|record|qualified|eliminated|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup)\b/.test(t);
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

function detectQueryDomain(queryText) {
    const text = String(queryText || '').toLowerCase();
    if (/\b(isro|nasa|esa|jaxa|spacex|rocket|mission|orbiter|lunar|moon|mars|satellite|space station|astronaut)\b/.test(text)) {
        return 'space_science';
    }
    if (/\b(ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup|score|winner|standings|rankings|player|team|coach|captain)\b/.test(text)) {
        return 'sports';
    }
    if (/\b(president|prime minister|minister|senator|mp|mla|election|party|government|parliament|chief minister|mayor)\b/.test(text)) {
        return 'politics';
    }
    if (/\b(stock|shares|price|market cap|repo rate|interest rate|inflation|bank|rbi|sebi|nasdaq|dow|gold|silver|platinum|diamond|palladium|petrol|diesel|gasoline|brent|wti|crude|commodity|fuel)\b/.test(text)) {
        return 'finance';
    }
    if (/\b(ceo|founder|company|startup|ai|llm|gpu|cpu|software|chip|nvidia|microsoft|openai|google)\b/.test(text)) {
        return 'tech';
    }
    if (/\b(actor|actress|movie|film|films|cinema|director|producer|singer|song|songs|album|albums|show|series|web series|filmography|discography|imdb|box office|release)\b/.test(text)) {
        return 'entertainment';
    }
    return 'general';
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
        const rawHref = decodeHtmlEntities(String(match[1] || '').trim());
        const resolvedHref = normalizeDuckDuckGoResultUrl(rawHref);
        const url = sanitizeExternalUrl(resolvedHref);
        const title = decodeHtmlEntities(stripTags(String(match[2] || '').trim()));
        if (!url || !title) continue;
        out.push({ title, url, description: title });
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
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];

    return hits.slice(0, maxResults).map((item) => {
        const title = String(item?.title || '').trim();
        const snippet = decodeHtmlEntities(stripTags(String(item?.snippet || '').trim()));
        return {
            title: title || 'Wikipedia result',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
            description: snippet || title
        };
    }).filter(item => item.url);
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
        const urlValue = sanitizeExternalUrl(decodeXml(getTag(block, 'link')));
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
