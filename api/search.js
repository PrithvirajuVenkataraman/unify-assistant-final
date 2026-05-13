export const config = { maxDuration: 60 };
import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './live-search.js';
import { applyApiSecurity } from './security.js';

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 48 * 1024,
        rateLimit: { max: 40, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

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
        const rawResults = verified.results.length ? verified.results : await searchWeb(query, maxResults);
        const asOf = new Date().toISOString();
        const results = rawResults.map(item => ({
            ...item,
            canonicalUrl: buildCanonicalUrl(item?.url || ''),
            publishedAt: extractPublishedAtIso(item)
        }));

        return res.status(200).json({
            success: true,
            provider: results.length ? 'aggregated-search' : 'none',
            queryVariants: liveQueries,
            queryVariantsUsed: liveQueries,
            asOf,
            distinctDomainCount: verified.distinctDomains?.length || 0,
            trustedCount: verified.trustedCount || 0,
            results
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            provider: 'none',
            queryVariants: [],
            queryVariantsUsed: [],
            asOf: new Date().toISOString(),
            distinctDomainCount: 0,
            trustedCount: 0,
            results: [],
            error: 'search_unavailable',
        });
    }
}

function buildCanonicalUrl(input) {
    try {
        const parsed = new URL(String(input || '').trim());
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') return '';
        const dropKeys = new Set([
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'utm_id', 'gclid', 'fbclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'ref_src'
        ]);
        const kept = [];
        for (const [k, v] of parsed.searchParams.entries()) {
            if (dropKeys.has(String(k || '').toLowerCase())) continue;
            kept.push([k, v]);
        }
        kept.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
        const query = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        return `${protocol}//${host}${normalizedPath}${query ? `?${query}` : ''}`;
    } catch (_) {
        return '';
    }
}

function extractPublishedAtIso(result) {
    const title = String(result?.title || '');
    const description = String(result?.description || '');
    const combined = `${title} ${description}`;

    const monthDayYear = combined.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i);
    if (monthDayYear) {
        const parsed = Date.parse(monthDayYear[0]);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    const ymd = combined.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
    if (ymd) {
        const parsed = Date.parse(`${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    const mdy = combined.match(/\b(0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])[-\/.](20\d{2})\b/);
    if (mdy) {
        const parsed = Date.parse(`${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    return null;
}


function buildSearchQueries(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];
    const topic = extractSearchTopic(raw) || raw;
    const out = [topic];
    const aliasedTopic = normalizeSearchTopic(topic);
    const domain = detectQueryDomain(raw);
    const entertainmentVariants = buildEntertainmentQueryVariants(raw, aliasedTopic || topic, domain);
    const broadFactualVariants = buildBroadFactualEntityVariants(raw, aliasedTopic || topic, domain);
    if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
        out.push(aliasedTopic);
    }
    const dynamicVariants = buildDynamicQueryVariants(raw, aliasedTopic || topic, domain);
    out.push(...dynamicVariants);
    out.push(...entertainmentVariants);
    out.push(...broadFactualVariants);

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

function isPureHowToOrCodingConceptSearch(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return false;
    const technicalSignals = /\b(hld|lld|system design|design pattern|architecture|algorithm|data structure|time complexity|space complexity|javascript|typescript|python|java|react|node|sql|backend|frontend|microservices?|docker|kubernetes|devops|debug|bug fix|refactor|unit test)\b/;
    const howToSignals = /^(how to|how do i|how can i|tutorial|guide|walk me through|show me how to)\b/;
    const liveSignals = /\b(current|latest|today|now|news|release|market|price|rate|winner|score)\b/;
    return (technicalSignals.test(t) && !liveSignals.test(t)) || (howToSignals.test(t) && technicalSignals.test(t));
}

function isBroadFactualPromptSearch(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (isPureHowToOrCodingConceptSearch(raw)) return false;
    if (/^(what do you think of|what are your thoughts on|thoughts on)\b/i.test(raw)) return false;
    const factualAskPattern = /^(who is|who was|what is|what was|when did|when was|where is|where was|tell me about|define|meaning of|do you know)\b/i;
    const worldFactSignal = /\b(company|person|founder|ceo|president|prime minister|captain|coach|team|club|country|city|state|movie|film|song|album|actor|actress|director|scientist|astronaut|war|election|festival|holiday|record|title|stats?|score|winner|result)\b/i;
    return factualAskPattern.test(raw) && worldFactSignal.test(raw);
}

function extractBroadFactualSubject(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const patterns = [
        /^(?:who is|who was|what is|what was|tell me about|define|meaning of|do you know)\s+(.+?)\??$/i,
        /^(?:when did|when was)\s+(.+?)\s+(?:release|released|come out|premiere|premiered)\b.*$/i,
        /^(?:where is|where was)\s+(.+?)\??$/i
    ];
    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1]) {
            return normalizeSearchTopic(match[1]
                .replace(/^(a|an|the)\s+/i, '')
                .replace(/[?.!,;]+$/g, '')
                .trim());
        }
    }
    return '';
}

function extractBroadFactualRole(text) {
    const match = String(text || '').toLowerCase().match(/\b(ceo|founder|president|prime minister|captain|coach|chairman|chairperson|governor|mayor|minister|director general|administrator|head)\b/);
    return match?.[1] || '';
}

function getTrustedSourceHintForDomain(domain) {
    const d = String(domain || '').toLowerCase();
    if (d === 'sports') return 'site:espncricinfo.com OR site:iplt20.com OR site:fifa.com';
    if (d === 'finance') return 'site:reuters.com OR site:bloomberg.com OR site:marketwatch.com';
    if (d === 'politics') return 'site:reuters.com OR site:apnews.com OR site:bbc.com';
    if (d === 'space_science') return 'site:nasa.gov OR site:isro.gov.in OR site:esa.int';
    if (d === 'entertainment') return 'site:imdb.com OR site:wikipedia.org';
    return 'site:reuters.com OR site:apnews.com OR site:bbc.com';
}

function buildBroadFactualEntityVariants(rawQuery, topic, domain) {
    const raw = String(rawQuery || '').trim();
    if (!isBroadFactualPromptSearch(raw)) return [];

    const subject = extractBroadFactualSubject(raw) || String(topic || '').trim();
    if (!subject) return [];
    const role = extractBroadFactualRole(raw);
    const trustedHint = getTrustedSourceHintForDomain(domain);
    const hints = getDomainHints(domain);
    const variants = [
        `${subject} ${hints.primary}`.trim(),
        `${subject} official profile`.trim(),
        `${subject} verified sources`.trim(),
        `${subject} ${trustedHint}`.trim()
    ];
    if (role) {
        variants.push(`${subject} current ${role}`.trim());
        variants.push(`${subject} ${role} official`.trim());
    }
    return Array.from(new Set(variants.filter(Boolean)));
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
