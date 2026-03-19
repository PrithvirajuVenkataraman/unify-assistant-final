import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './live-search.js';

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
        const maxResults = Math.min(Math.max(Number(req.body?.maxResults || 8), 1), 10);
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }
        if (query.length > 500) {
            return res.status(413).json({ error: 'query is too long' });
        }

        const liveQueries = buildSearchQueries(query);
        const verified = await runVerifiedWebSearch(liveQueries, {
            maxResultsPerQuery: Math.min(maxResults, 6),
            limit: maxResults
        });
        const results = verified.results.length ? verified.results : await searchWeb(query, maxResults);

        return res.status(200).json({
            success: true,
            provider: results.length ? 'aggregated-search' : 'none',
            queryVariants: liveQueries,
            distinctDomainCount: verified.distinctDomains?.length || 0,
            trustedCount: verified.trustedCount || 0,
            results
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            provider: 'none',
            queryVariants: [],
            distinctDomainCount: 0,
            trustedCount: 0,
            results: [],
            error: 'search_unavailable',
            details: String(error?.message || error)
        });
    }
}

function buildSearchQueries(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];
    const topic = extractSearchTopic(raw) || raw;
    const out = [topic];
    const aliasedTopic = normalizeSearchTopic(topic);
    const domain = detectQueryDomain(raw);
    const entertainmentVariants = buildEntertainmentQueryVariants(raw, aliasedTopic || topic, domain);
    if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
        out.push(aliasedTopic);
    }
    const dynamicVariants = buildDynamicQueryVariants(raw, aliasedTopic || topic, domain);
    out.push(...dynamicVariants);
    out.push(...entertainmentVariants);

    if (isTimeSensitiveQuery(raw)) {
        const timeAwareTopic = raw
            .replace(/\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update(?:s)? on|status of|winner|won|champion|score|scores|stats|standings|points table|ranking|rankings|record|qualified|eliminated)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const cleanedTimeAwareTopic = extractSearchTopic(timeAwareTopic) || topic;
        if (cleanedTimeAwareTopic && cleanedTimeAwareTopic.toLowerCase() !== topic.toLowerCase()) {
            out.push(cleanedTimeAwareTopic);
        }
        out.push(`latest ${cleanedTimeAwareTopic || topic}`);
        out.push(`${cleanedTimeAwareTopic || topic} Reuters OR AP OR BBC OR Al Jazeera`);
        out.push(...buildTimeSensitiveDomainVariants(cleanedTimeAwareTopic || topic, domain));
        if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
            out.push(`latest ${aliasedTopic}`);
            out.push(`${aliasedTopic} Reuters OR AP OR BBC OR Al Jazeera`);
            out.push(...buildTimeSensitiveDomainVariants(aliasedTopic, domain));
        }
    }

    return Array.from(new Set(out.filter(Boolean)));
}

function isTimeSensitiveQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update|status|price now|rate today|winner|won|champion|score|scores|live score|stats|standings|points table|ranking|rankings|record|qualified|eliminated|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup|nasa|isro|esa|jaxa|cern|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|rbi|sebi|imf|nato|eu|tcs|ibm|amd|ai|ml|llm|agi|gpu|cpu)\b/.test(t);
}

function buildDynamicQueryVariants(rawQuery, topic, domain) {
    const out = [];
    const acronymCandidates = extractAcronymCandidates(rawQuery);
    const domainHints = getDomainHints(domain);

    if (acronymCandidates.length) {
        out.push(`"${topic}"`);
        for (const token of acronymCandidates) {
            out.push(`${token} ${domainHints.primary}`);
            if (domainHints.secondary) {
                out.push(`${token} ${domainHints.secondary}`);
            }
            if (topic.toLowerCase() !== token.toLowerCase()) {
                out.push(`"${token}" ${topic}`);
            }
        }
    }

    if (domainHints.context && !topic.toLowerCase().includes(domainHints.context.toLowerCase())) {
        out.push(`${topic} ${domainHints.context}`);
    }

    return out;
}

function buildEntertainmentQueryVariants(rawQuery, topic, domain) {
    if (domain !== 'entertainment') return [];

    const out = [];
    const normalizedRaw = String(rawQuery || '').trim();
    const subject = extractEntertainmentSubject(normalizedRaw) || String(topic || '').trim();
    if (!subject) return out;

    if (isLatestFilmQuery(normalizedRaw)) {
        out.push(`${subject} latest movie`);
        out.push(`${subject} latest film`);
        out.push(`${subject} most recent film`);
        out.push(`${subject} filmography latest movie`);
        out.push(`${subject} imdb latest movie`);
        out.push(`${subject} wikipedia filmography`);
    }

    if (isLatestSongOrAlbumQuery(normalizedRaw)) {
        out.push(`${subject} latest song`);
        out.push(`${subject} latest album`);
        out.push(`${subject} discography latest`);
    }

    return out;
}

function expandCriticalQueryAliases(text) {
    return normalizeSearchTopic(text);
}

function normalizeSearchTopic(text) {
    return String(text || '')
        .replace(/[^\w\s&.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildTimeSensitiveDomainVariants(topic, domain) {
    const base = String(topic || '').trim();
    if (!base) return [];

    const hints = getDomainHints(domain);
    const out = [];
    if (hints.fresh) out.push(`${base} ${hints.fresh}`);
    if (hints.official) out.push(`${base} ${hints.official}`);
    return out;
}

function extractAcronymCandidates(text) {
    const raw = String(text || '');
    if (!raw) return [];

    const matches = raw.match(/\b[a-zA-Z0-9&.-]{2,10}\b/g) || [];
    return Array.from(new Set(
        matches.filter(token => isLikelyAcronymToken(token)).map(token => token.toUpperCase())
    ));
}

function isLikelyAcronymToken(token) {
    const value = String(token || '').trim();
    if (!value) return false;
    if (/^\d+$/.test(value)) return false;
    if (value.length === 1 || value.length > 10) return false;
    if (/^[A-Z0-9]{2,10}$/.test(value)) return true;
    return /^[A-Z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(value);
}

function detectQueryDomain(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(score|scores|winner|won|champion|standings|ranking|rankings|stats|team|player|match|tournament|league|season|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup)\b/.test(t)) {
        return 'sports';
    }
    if (/\b(stock|stocks|share|shares|market|market cap|earnings|price|repo rate|interest rate|inflation|forex|exchange rate|rbi|sebi|imf|gold|silver|platinum|diamond|palladium|petrol|diesel|gasoline|crude|brent|wti|commodity|fuel)\b/.test(t)) {
        return 'finance';
    }
    if (/\b(president|prime minister|election|party|government|minister|parliament|senate|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|nato|eu)\b/.test(t)) {
        return 'politics';
    }
    if (/\b(isro|nasa|esa|jaxa|spacex|rocket|mission|orbiter|lunar|moon|mars|satellite|space station|astronaut)\b/.test(t)) {
        return 'space_science';
    }
    if (/\b(ai|ml|llm|agi|gpu|cpu|chip|software|hardware|startup|company|ceo|founder|nasa|isro|esa|jaxa|cern|tcs|ibm|amd)\b/.test(t)) {
        return 'tech';
    }
    if (/\b(actor|actress|movie|film|films|cinema|director|producer|singer|song|songs|album|albums|show|series|web series|filmography|discography|imdb|box office|release)\b/.test(t)) {
        return 'entertainment';
    }
    return 'general';
}

function getDomainHints(domain) {
    switch (domain) {
        case 'sports':
            return {
                primary: 'sports',
                secondary: 'league team match',
                context: 'official standings results',
                fresh: 'latest score result',
                official: 'official site result'
            };
        case 'finance':
            return {
                primary: 'finance',
                secondary: 'stock commodity fuel market',
                context: 'official exchange commodity pricing',
                fresh: 'latest price market update',
                official: 'Bloomberg Reuters Nasdaq NYSE NSE BSE official prices'
            };
        case 'space_science':
            return {
                primary: 'space mission',
                secondary: 'isro nasa esa',
                context: 'official space agency update',
                fresh: 'latest mission update',
                official: 'isro.gov.in nasa.gov official statement'
            };
        case 'politics':
            return {
                primary: 'politics',
                secondary: 'party government election',
                context: 'official government source',
                fresh: 'latest update news',
                official: 'official government statement'
            };
        case 'tech':
            return {
                primary: 'technology',
                secondary: 'company product research',
                context: 'official company source',
                fresh: 'latest update',
                official: 'official announcement'
            };
        case 'entertainment':
            return {
                primary: 'entertainment',
                secondary: 'filmography movie release',
                context: 'imdb wikipedia filmography',
                fresh: 'latest release filmography',
                official: 'official movie page imdb'
            };
        default:
            return {
                primary: 'official',
                secondary: 'reference',
                context: 'reliable source',
                fresh: 'latest update',
                official: 'official source'
            };
    }
}

function isLatestFilmQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|new|newest|most recent|current|upcoming)\b/.test(t) &&
        /\b(movie|film|films|cinema|release|filmography)\b/.test(t);
}

function isLatestSongOrAlbumQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|new|newest|most recent|current|upcoming)\b/.test(t) &&
        /\b(song|songs|album|albums|single|discography)\b/.test(t);
}

function extractEntertainmentSubject(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const patterns = [
        /\b(?:latest|recent|new|newest|most recent|current|upcoming)\s+(?:movie|film|release)\s+(?:of|from|by)\s+(?:actor|actress|director|singer)?\s*([^?.!,]+)$/i,
        /\b(?:what is|which is|tell me|show me)\s+(?:the\s+)?(?:latest|recent|new|newest|most recent|current|upcoming)\s+(?:movie|film|release)\s+(?:of|from|by)\s+(?:actor|actress|director|singer)?\s*([^?.!,]+)$/i,
        /\b(?:actor|actress|director|singer)\s+([^?.!,]+?)\s+(?:latest|recent|new|newest|most recent|current|upcoming)\s+(?:movie|film|release)\b/i,
        /\b(?:what is|which is|tell me|show me)\s+(?:the\s+)?(?:latest|recent|new|newest|most recent|current|upcoming)\s+([^?.!,]+?)\s+(?:movie|film|release)\b/i,
        /\b(?:latest|recent|new|newest|most recent|current|upcoming)\s+([^?.!,]+?)\s+(?:movie|film|release)\b/i
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1]) {
            return normalizeSearchTopic(match[1]
                .replace(/\b(actor|actress|director|singer)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim());
        }
    }

    return normalizeSearchTopic(raw
        .replace(/\b(what|which|tell|show|me|is|the|latest|recent|new|newest|most recent|current|upcoming|movie|film|release|of|from|by|actor|actress|director|singer)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim());
}
