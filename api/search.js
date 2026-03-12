import { extractSearchTopic, runVerifiedWebSearch, searchWeb } from './_lib/live-search.js';

const QUERY_ALIASES = {
    ipl: 'indian premier league',
    psl: 'pakistan super league',
    bbl: 'big bash league',
    cpl: 'caribbean premier league',
    isl: 'indian super league',
    pkl: 'pro kabaddi league',
    ucl: 'uefa champions league',
    uel: 'uefa europa league',
    epl: 'english premier league',
    nba: 'national basketball association',
    nfl: 'national football league',
    mlb: 'major league baseball',
    nhl: 'national hockey league',
    atp: 'association of tennis professionals',
    wta: 'women s tennis association',
    f1: 'formula 1',
    nasa: 'national aeronautics and space administration',
    isro: 'indian space research organisation',
    esa: 'european space agency',
    jaxa: 'japan aerospace exploration agency',
    cern: 'european organization for nuclear research',
    bjp: 'bharatiya janata party',
    aap: 'aam aadmi party',
    dmk: 'dravida munnetra kazhagam',
    aiadmk: 'all india anna dravida munnetra kazhagam',
    tdp: 'telugu desam party',
    ysrcp: 'ysr congress party',
    bjd: 'biju janata dal',
    rbi: 'reserve bank of india',
    sebi: 'securities and exchange board of india',
    imf: 'international monetary fund',
    nato: 'north atlantic treaty organization',
    eu: 'european union',
    tcs: 'tata consultancy services',
    ibm: 'international business machines',
    amd: 'advanced micro devices',
    ai: 'artificial intelligence',
    ml: 'machine learning',
    llm: 'large language model',
    agi: 'artificial general intelligence',
    gpu: 'graphics processing unit',
    cpu: 'central processing unit'
};

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
        return res.status(500).json({
            success: false,
            error: 'search failed'
        });
    }
}

function buildSearchQueries(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];
    const topic = extractSearchTopic(raw) || raw;
    const out = [topic];
    const expandedTopic = expandKnownQueryAliases(topic);

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
    }

    if (expandedTopic && expandedTopic.toLowerCase() !== topic.toLowerCase()) {
        out.push(expandedTopic);
        if (isTimeSensitiveQuery(raw)) {
            out.push(`latest ${expandedTopic}`);
            out.push(`${expandedTopic} official result`);
        }
    }

    return Array.from(new Set(out.filter(Boolean)));
}

function isTimeSensitiveQuery(text) {
    const t = String(text || '').toLowerCase();
    return /\b(latest|recent|current|today|right now|as of now|breaking|news|headlines?|update|status|price now|rate today|winner|won|champion|score|scores|live score|stats|standings|points table|ranking|rankings|record|qualified|eliminated|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup|nasa|isro|esa|jaxa|cern|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|rbi|sebi|imf|nato|eu|tcs|ibm|amd|ai|ml|llm|agi|gpu|cpu)\b/.test(t);
}

function expandKnownQueryAliases(text) {
    return String(text || '')
        .split(/\s+/)
        .map(token => QUERY_ALIASES[token.toLowerCase()] || token)
        .join(' ')
        .trim();
}
