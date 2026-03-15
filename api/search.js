import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './live-search.js';

const MAX_QUERY_LENGTH = 500;
const DEFAULT_MAX_RESULTS = 8;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;

const ROLE_LABELS = [
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

const ROLE_PATTERN = new RegExp(`\\b(${ROLE_LABELS.map(([label]) => escapeRegExp(label)).join('|')})\\b`, 'i');
const FRESHNESS_PATTERN = /\b(current|latest|now|right now|as of now|today|present)\b/i;
const LOOKUP_PATTERN = /\bwho(?:'s| is)?\b|\bname of\b|\bwho heads\b|\bwho leads\b|\bwho runs\b/i;
const ORGANIZATION_CUE_PATTERN = /\b(of|at|for)\b|\b(company|corp|ltd|inc|llc|plc)\b/i;
const CURRENT_ROLE_CLEANUP_PATTERN = new RegExp(`\\b(${ROLE_LABELS.map(([label]) => escapeRegExp(label)).join('|')})\\b`, 'gi');
const TIME_SENSITIVE_PATTERN = /\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update|updates|status|price now|rate today|winner|won|champion|score|scores|live score|stats|standings|points table|ranking|rankings|record|qualified|eliminated|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup|nasa|isro|esa|jaxa|cern|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|rbi|sebi|imf|nato|eu|tcs|ibm|amd|ai|ml|llm|agi|gpu|cpu)\b/i;
const TIME_SENSITIVE_STRIP_PATTERN = /\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update(?:s)? on|status of|winner|won|champion|score|scores|stats|standings|points table|ranking|rankings|record|qualified|eliminated)\b/gi;

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
        const query = normalizeQuery(req.body?.query);
        const maxResults = clampInteger(req.body?.maxResults, DEFAULT_MAX_RESULTS, MIN_MAX_RESULTS, MAX_MAX_RESULTS);

        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }

        if (query.length > MAX_QUERY_LENGTH) {
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

        const results = verified?.results?.length
            ? verified.results
            : await searchWeb(query, maxResults);

        return res.status(200).json({
            success: true,
            provider: results.length ? 'aggregated-search' : 'none',
            queryVariants: liveQueries,
            distinctDomainCount: verified?.distinctDomains?.length || 0,
            trustedCount: verified?.trustedCount || 0,
            forcedCurrentRoleLookup: strictCurrentRoleLookup,
            results: Array.isArray(results) ? results : []
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

export function buildSearchQueries(query) {
    const raw = normalizeQuery(query);
    if (!raw) return [];

    const topic = extractSearchTopic(raw) || raw;
    const cleanTopic = normalizeSearchTopic(topic);
    const aliasedTopic = expandCriticalQueryAliases(cleanTopic);
    const searchTopic = aliasedTopic || cleanTopic || raw;
    const domain = detectQueryDomain(raw);

    if (isCurrentRoleLookup(raw)) {
        return buildCurrentRoleQueries(raw, searchTopic);
    }

    const variants = [];
    pushUnique(variants, topic);
    pushUnique(variants, cleanTopic);
    pushUnique(variants, aliasedTopic);

    if (aliasedTopic && aliasedTopic.toLowerCase() !== cleanTopic.toLowerCase()) {
        pushUnique(variants, `${cleanTopic} ${aliasedTopic}`);
    }

    pushUniqueMany(variants, buildDynamicQueryVariants(raw, searchTopic, domain));

    if (isTimeSensitiveQuery(raw)) {
        const timeAwareTopic = normalizeQuery(raw.replace(TIME_SENSITIVE_STRIP_PATTERN, ' '));
        const cleanedTimeAwareTopic = normalizeSearchTopic(extractSearchTopic(timeAwareTopic) || searchTopic);
        const base = cleanedTimeAwareTopic || searchTopic;

        pushUnique(variants, base);
        pushUnique(variants, `latest ${base}`);
        pushUnique(variants, `${base} Reuters OR AP OR BBC OR Al Jazeera`);
        pushUniqueMany(variants, buildTimeSensitiveDomainVariants(base, domain));

        if (aliasedTopic && aliasedTopic.toLowerCase() !== base.toLowerCase()) {
            pushUnique(variants, `latest ${aliasedTopic}`);
            pushUnique(variants, `${aliasedTopic} Reuters OR AP OR BBC OR Al Jazeera`);
            pushUniqueMany(variants, buildTimeSensitiveDomainVariants(aliasedTopic, domain));
        }
    }

    return variants.filter(Boolean);
}

export function isTimeSensitiveQuery(text) {
    return TIME_SENSITIVE_PATTERN.test(String(text || '').toLowerCase());
}

export function isCurrentRoleLookup(text) {
    const value = normalizeQuery(text).toLowerCase();
    if (!value) return false;

    const hasRole = ROLE_PATTERN.test(value);
    const hasFreshness = FRESHNESS_PATTERN.test(value);
    const hasLookupPattern = LOOKUP_PATTERN.test(value);
    const hasOrgCue = ORGANIZATION_CUE_PATTERN.test(value);

    return hasRole && (hasFreshness || hasLookupPattern || hasOrgCue);
}

export function extractRoleFromQuery(text) {
    const value = normalizeQuery(text).toLowerCase();
    if (!value) return '';

    for (const [needle, normalized] of ROLE_LABELS) {
        if (value.includes(needle)) {
            return normalized;
        }
    }

    return '';
}

export function extractOrganizationFromRoleQuery(text, roleLabel = '') {
    let raw = normalizeQuery(text);
    if (!raw) return '';

    const escapedRole = roleLabel ? escapeRegExp(roleLabel) : '';
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
            .replace(CURRENT_ROLE_CLEANUP_PATTERN, ' ')
            .replace(/^of\s+/i, '')
            .replace(/[?]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

export function buildCurrentRoleQueries(rawQuery, cleanTopic = '') {
    const roleLabel = extractRoleFromQuery(rawQuery) || 'leadership';
    const company = extractOrganizationFromRoleQuery(rawQuery, roleLabel) || normalizeSearchTopic(cleanTopic);
    const quotedCompany = company.includes(' ') ? `"${company}"` : company;
    const target = quotedCompany || cleanTopic;

    const queries = [];
    pushUnique(queries, `${target} ${roleLabel} official site`);
    pushUnique(queries, `${target} ${roleLabel} investor relations`);
    pushUnique(queries, `${target} leadership team official`);
    pushUnique(queries, `${target} management team official`);
    pushUnique(queries, `${target} board of directors official`);
    pushUnique(queries, `${target} annual report ${roleLabel}`);
    pushUnique(queries, `${target} SEC filing ${roleLabel}`);
    pushUnique(queries, `${target} Reuters ${roleLabel}`);
    pushUnique(queries, `${target} Bloomberg ${roleLabel}`);
    pushUnique(queries, `${target} official leadership page`);
    return queries.filter(Boolean);
}

export function buildDynamicQueryVariants(rawQuery, topic, domain) {
    const out = [];
    const cleanTopic = normalizeSearchTopic(topic);
    const acronymCandidates = extractAcronymCandidates(rawQuery);
    const domainHints = getDomainHints(domain);

    if (acronymCandidates.length) {
        pushUnique(out, `"${cleanTopic}"`);
        for (const token of acronymCandidates) {
            pushUnique(out, `${token} ${domainHints.primary}`);
            if (domainHints.secondary) {
                pushUnique(out, `${token} ${domainHints.secondary}`);
            }
            if (cleanTopic && cleanTopic.toLowerCase() !== token.toLowerCase()) {
                pushUnique(out, `"${token}" ${cleanTopic}`);
            }
        }
    }

    if (domainHints.context && cleanTopic && !cleanTopic.toLowerCase().includes(domainHints.context.toLowerCase())) {
        pushUnique(out, `${cleanTopic} ${domainHints.context}`);
    }

    return out;
}

export function expandCriticalQueryAliases(text) {
    return normalizeSearchTopic(text);
}

export function normalizeSearchTopic(text) {
    return String(text || '')
        .replace(/[^\w\s&.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildTimeSensitiveDomainVariants(topic, domain) {
    const base = normalizeSearchTopic(topic);
    if (!base) return [];

    const hints = getDomainHints(domain);
    const out = [];
    if (hints.fresh) pushUnique(out, `${base} ${hints.fresh}`);
    if (hints.official) pushUnique(out, `${base} ${hints.official}`);
    return out;
}

export function extractAcronymCandidates(text) {
    const raw = String(text || '');
    if (!raw) return [];

    const matches = raw.match(/\b[a-zA-Z0-9&.-]{2,10}\b/g) || [];
    return Array.from(
        new Set(matches.filter((token) => isLikelyAcronymToken(token)).map((token) => token.toUpperCase()))
    );
}

export function isLikelyAcronymToken(token) {
    const value = String(token || '').trim();
    if (!value) return false;
    if (/^\d+$/.test(value)) return false;
    if (value.length === 1 || value.length > 10) return false;
    if (/^[A-Z0-9]{2,10}$/.test(value)) return true;
    return /^[A-Z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(value);
}

export function detectQueryDomain(text) {
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

export function getDomainHints(domain) {
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

function normalizeQuery(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function pushUnique(list, value) {
    const normalized = normalizeQuery(value);
    if (!normalized) return;
    if (!list.includes(normalized)) {
        list.push(normalized);
    }
}

function pushUniqueMany(list, values) {
    for (const value of values || []) {
        pushUnique(list, value);
    }
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
