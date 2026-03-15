import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './_lib/live-search.js';

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

        const strictCurrentRoleLookup = isCurrentRoleLookup(query);
        const liveQueries = buildSearchQueries(query);
        console.log('SEARCH QUESTION:', query);
        console.log('SEARCH FORCE CURRENT ROLE LOOKUP:', strictCurrentRoleLookup);
        console.log('SEARCH QUERY VARIANTS:', liveQueries);

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
            forcedCurrentRoleLookup: strictCurrentRoleLookup,
            results
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            provider: 'none',
            queryVariants: [],
            distinctDomainCount: 0,
            trustedCount: 0,
            forcedCurrentRoleLookup: false,
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

    if (isCurrentRoleLookup(raw)) {
        return buildCurrentRoleQueries(raw, aliasedTopic || topic);
    }

    if (aliasedTopic && aliasedTopic.toLowerCase() !== topic.toLowerCase()) {
        out.push(aliasedTopic);
    }

    const dynamicVariants = buildDynamicQueryVariants(raw, aliasedTopic || topic, domain);
    out.push(...dynamicVariants);

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

function isCurrentRoleLookup(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;

    const hasRole = /\b(ceo|chief executive officer|cfo|chief financial officer|cto|chief technology officer|coo|chief operating officer|chief product officer|chief revenue officer|founder|co-founder|owner|president|chairman|chairperson|chair|managing director|director|executive director|general manager|md)\b/i.test(t);
    const hasFreshness = /\b(current|latest|now|right now|as of now|today|present)\b/i.test(t);
    const hasLookupPattern = /\bwho(?:'s| is)?\b/i.test(t) || /\bname of\b/i.test(t) || /\bwho heads\b/i.test(t) || /\bwho leads\b/i.test(t);
    const hasOrgCue = /\b(of|at|for)\b/i.test(t) || /\bcompany\b/i.test(t) || /\bcorp\b/i.test(t) || /\bltd\b/i.test(t) || /\binc\b/i.test(t) || /\bllc\b/i.test(t) || /\bplc\b/i.test(t);

    return hasRole && (hasFreshness || hasLookupPattern || hasOrgCue);
}

function extractRoleFromQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const roles = [
        ['chief executive officer', 'CEO'],
        ['ceo', 'CEO'],
        ['chief financial officer', 'CFO'],
        ['cfo', 'CFO'],
        ['chief technology officer', 'CTO'],
        ['cto', 'CTO'],
        ['chief operating officer', 'COO'],
        ['coo', 'COO'],
        ['chief product officer', 'Chief Product Officer'],
        ['chief revenue officer', 'Chief Revenue Officer'],
        ['co-founder', 'Co-Founder'],
        ['founder', 'Founder'],
        ['chairperson', 'Chairperson'],
        ['chairman', 'Chairman'],
        ['chair', 'Chair'],
        ['owner', 'Owner'],
        ['president', 'President'],
        ['managing director', 'Managing Director'],
        ['executive director', 'Executive Director'],
        ['director', 'Director'],
        ['general manager', 'General Manager'],
        ['md', 'Managing Director']
    ];

    const lowered = raw.toLowerCase();
    for (const [needle, normalized] of roles) {
        if (lowered.includes(needle)) return normalized;
    }

    return '';
}

function extractOrganizationFromRoleQuery(text, roleLabel = '') {
    let raw = String(text || '').trim();
    if (!raw) return '';

    const escapedRole = roleLabel
        ? roleLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : '';

    const patterns = [
        escapedRole ? new RegExp(`\\b(?:who(?:'s| is)?\\s+the\\s+)?(?:current|latest|present)?\\s*${escapedRole}\\s+(?:of|at|for)\\s+(.+)$`, 'i') : null,
        escapedRole ? new RegExp(`\\b${escapedRole}\\s+(?:of|at|for)\\s+(.+)$`, 'i') : null,
        /\b(?:who heads|who leads|who runs)\s+(.+)$/i,
        /\b(?:leadership|executive team|management team)\s+(?:of|at|for)\s+(.+)$/i
    ].filter(Boolean);

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1]) {
            raw = match[1];
            break;
        }
    }

    return normalizeSearchTopic(
        raw
            .replace(/^(?:the\s+)?(?:company\s+)?/i, '')
            .replace(/\b(current|latest|present|right now|today|now)\b/gi, ' ')
            .replace(/\b(ceo|chief executive officer|cfo|chief financial officer|cto|chief technology officer|coo|chief operating officer|chief product officer|chief revenue officer|founder|co-founder|owner|president|chairman|chairperson|chair|managing director|director|executive director|general manager|md)\b/gi, ' ')
            .replace(/^of\s+/i, '')
            .replace(/[?]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function buildCurrentRoleQueries(rawQuery, cleanTopic) {
    const roleLabel = extractRoleFromQuery(rawQuery) || 'leadership';
    const company = extractOrganizationFromRoleQuery(rawQuery, roleLabel) || cleanTopic;
    const quotedCompany = company.includes(' ') ? `"${company}"` : company;

    return Array.from(new Set([
        `${quotedCompany} ${roleLabel} official site`,
        `${quotedCompany} ${roleLabel} investor relations`,
        `${quotedCompany} leadership team official`,
        `${quotedCompany} management team official`,
        `${quotedCompany} board of directors official`,
        `${quotedCompany} annual report ${roleLabel}`,
        `${quotedCompany} SEC filing ${roleLabel}`,
        `${quotedCompany} Reuters ${roleLabel}`,
        `${quotedCompany} Bloomberg ${roleLabel}`,
        `${quotedCompany} official leadership page`
    ].filter(Boolean)));
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
        matches.filter((token) => isLikelyAcronymToken(token)).map((token) => token.toUpperCase())
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
    if (/\b(stock|stocks|share|shares|market|market cap|earnings|price|repo rate|interest rate|inflation|forex|exchange rate|rbi|sebi|imf)\b/.test(t)) {
        return 'finance';
    }
    if (/\b(president|prime minister|election|party|government|minister|parliament|senate|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|nato|eu)\b/.test(t)) {
        return 'politics';
    }
    if (/\b(ai|ml|llm|agi|gpu|cpu|chip|software|hardware|startup|company|ceo|founder|nasa|isro|esa|jaxa|cern|tcs|ibm|amd)\b/.test(t)) {
        return 'tech';
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
                secondary: 'stock company market',
                context: 'official market data',
                fresh: 'latest price market update',
                official: 'official filing company investor relations'
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
