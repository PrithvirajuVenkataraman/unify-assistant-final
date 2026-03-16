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

const COMMON_COMPETITION_EXPANSIONS = {
    f1: ['Formula 1'],
    formula1: ['Formula 1'],
    ipl: ['Indian Premier League'],
    psl: ['Pakistan Super League'],
    bbl: ['Big Bash League'],
    cpl: ['Caribbean Premier League'],
    isl: ['Indian Super League'],
    pkl: ['Pro Kabaddi League'],
    ucl: ['UEFA Champions League'],
    uel: ['UEFA Europa League'],
    epl: ['English Premier League'],
    nba: ['National Basketball Association'],
    nfl: ['National Football League'],
    mlb: ['Major League Baseball'],
    nhl: ['National Hockey League'],
    atp: ['ATP tennis'],
    wta: ['WTA tennis'],
    fifa: ['FIFA football'],
    uefa: ['UEFA football'],
    motogp: ['MotoGP motorcycle racing']
};

const SPORTS_ACHIEVEMENT_PATTERN = /\b(how many|total|number of)\b.*\b(cups|titles|trophies|championships|wins|races|grand prix|victories|rings|medals)\b/i;
const SPORTS_ENTITY_QUESTION_PATTERN = /\b(how many|total|number of|who won|who is|what is|when did)\b/i;
const AWKWARD_WIN_GRAMMAR_PATTERN = /\bdid\s+(.+?)\s+won\b/gi;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+/;
const ACHIEVEMENT_KEYWORD_PATTERN = /\b(cups|titles|trophies|championships|wins|won|races|grand prix|victories|rings|medals|trophy)\b/i;
const ZERO_ACHIEVEMENT_PATTERN = /\b(never won|has never won|have never won|no titles?|no trophies?|no championships?|without a title|without any titles?|titleless|yet to win|hasn'?t won|haven'?t won)\b/i;
const YEAR_NUMBER_PATTERN = /^(19|20)\d{2}$/;

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

        const safeResults = Array.isArray(results) ? results : [];
        const answer = buildGroundedAnswer({
            query,
            results: safeResults,
            strictCurrentRoleLookup
        });

        return res.status(200).json({
            success: true,
            provider: safeResults.length ? 'aggregated-search' : 'none',
            queryVariants: liveQueries,
            distinctDomainCount: verified?.distinctDomains?.length || 0,
            trustedCount: verified?.trustedCount || 0,
            forcedCurrentRoleLookup: strictCurrentRoleLookup,
            answer,
            results: safeResults
        });
    } catch (error) {
        return res.status(200).json({
            success: true,
            provider: 'none',
            queryVariants: [],
            distinctDomainCount: 0,
            trustedCount: 0,
            forcedCurrentRoleLookup: false,
            answer: '',
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
    pushUnique(variants, raw);
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

    pushUniqueMany(out, buildSemanticQueryVariants(rawQuery, cleanTopic, domain));

    return out;
}

export function expandCriticalQueryAliases(text) {
    const normalized = normalizeSearchTopic(text);
    if (!normalized) return '';

    let value = rewriteAwkwardQuestionGrammar(normalized);
    value = expandCommonCompetitionAliases(value);
    value = rewriteGenericAchievementTerms(value);
    value = simplifyHistoryPhrases(value);

    return normalizeSearchTopic(value);
}

function buildSemanticQueryVariants(rawQuery, topic, domain) {
    const out = [];
    const cleanRaw = normalizeQuery(rawQuery);
    const cleanTopic = normalizeSearchTopic(topic || rawQuery);
    const aliasedRaw = expandCriticalQueryAliases(cleanRaw);

    if (aliasedRaw && aliasedRaw.toLowerCase() !== cleanTopic.toLowerCase()) {
        pushUnique(out, aliasedRaw);
    }

    const competitionVariants = extractCompetitionVariants(cleanRaw);
    if (competitionVariants.length) {
        for (const item of competitionVariants) {
            if (cleanTopic && !cleanTopic.toLowerCase().includes(item.toLowerCase())) {
                pushUnique(out, `${cleanTopic} ${item}`);
            }
        }
    }

    if (domain === 'sports' && isSportsAchievementQuery(cleanRaw)) {
        const parts = extractSportsAchievementParts(cleanRaw);
        const entity = normalizeSearchTopic(parts.entity || cleanTopic);
        const competition = normalizeSearchTopic(parts.competition || competitionVariants[0] || '');
        const achievement = normalizeSearchTopic(parts.achievement || 'titles');
        const officialContext = competition || 'official record';

        if (entity) {
            pushUnique(out, `${entity} total ${achievement} ${competition}`);
            pushUnique(out, `${entity} total championships ${competition}`);
            pushUnique(out, `${entity} all time record ${competition}`);
            pushUnique(out, `${entity} official record ${officialContext}`);
            pushUnique(out, `${entity} stats ${competition}`);
        }
    }

    if (domain === 'sports' && SPORTS_ENTITY_QUESTION_PATTERN.test(cleanRaw)) {
        const normalizedQuestion = rewriteAwkwardQuestionGrammar(expandCommonCompetitionAliases(cleanRaw));
        if (normalizedQuestion && normalizedQuestion.toLowerCase() !== cleanTopic.toLowerCase()) {
            pushUnique(out, normalizedQuestion);
        }
    }

    return out.filter(Boolean);
}

function isSportsAchievementQuery(text) {
    const value = String(text || '').trim();
    return SPORTS_ACHIEVEMENT_PATTERN.test(value) || /\b(record|champion|titles|trophies|championships|wins|grand prix)\b/i.test(value);
}

function extractSportsAchievementParts(text) {
    const raw = normalizeQuery(text);
    const simplified = rewriteAwkwardQuestionGrammar(expandCommonCompetitionAliases(raw));
    const patterns = [
        /how many\s+(?<achievement>cups|titles|trophies|championships|wins|races|grand prix|victories|rings|medals)\s+did\s+(?<entity>.+?)\s+win(?:\s+(?:in|at|for)\s+(?<competition>.+))?$/i,
        /how many\s+(?<achievement>cups|titles|trophies|championships|wins|races|grand prix|victories|rings|medals)\s+has\s+(?<entity>.+?)(?:\s+won)?(?:\s+(?:in|at|for)\s+(?<competition>.+))?$/i,
        /(?<entity>.+?)\s+total\s+(?<achievement>titles|trophies|championships|wins|races|grand prix|victories|rings|medals)(?:\s+(?:in|at|for)\s+(?<competition>.+))?$/i
    ];

    for (const pattern of patterns) {
        const match = simplified.match(pattern);
        if (match?.groups) {
            return {
                entity: normalizeSearchTopic(match.groups.entity || ''),
                achievement: normalizeAchievementLabel(match.groups.achievement || ''),
                competition: normalizeCompetitionLabel(match.groups.competition || '')
            };
        }
    }

    return {
        entity: '',
        achievement: '',
        competition: normalizeCompetitionLabel(extractCompetitionVariants(simplified)[0] || '')
    };
}

function extractCompetitionVariants(text) {
    const raw = String(text || '');
    if (!raw) return [];

    const variants = [];
    const tokens = raw.match(/\b[a-zA-Z0-9&.-]{2,20}\b/g) || [];
    for (const token of tokens) {
        const mapped = COMMON_COMPETITION_EXPANSIONS[token.toLowerCase()];
        if (Array.isArray(mapped)) {
            for (const item of mapped) {
                pushUnique(variants, item);
            }
        }
    }

    return variants;
}

function expandCommonCompetitionAliases(text) {
    let value = String(text || '');
    for (const [token, expansions] of Object.entries(COMMON_COMPETITION_EXPANSIONS)) {
        if (!expansions.length) continue;
        const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi');
        value = value.replace(pattern, expansions[0]);
    }
    return value;
}

function rewriteAwkwardQuestionGrammar(text) {
    return String(text || '')
        .replace(AWKWARD_WIN_GRAMMAR_PATTERN, 'did $1 win')
        .replace(/\bwho won in\b/gi, 'who won')
        .replace(/\bhow many cups did\b/gi, 'how many titles did')
        .replace(/\bhow many cups has\b/gi, 'how many titles has');
}

function rewriteGenericAchievementTerms(text) {
    return String(text || '')
        .replace(/\bcups\b/gi, 'titles')
        .replace(/\bgrand prix wins\b/gi, 'grand prix victories');
}

function simplifyHistoryPhrases(text) {
    return String(text || '')
        .replace(/\bin\s+history\b/gi, '')
        .replace(/\bhistory\b/gi, 'all time')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAchievementLabel(value) {
    const text = String(value || '').toLowerCase().trim();
    if (!text) return '';
    if (text === 'cups') return 'titles';
    if (text === 'races') return 'race wins';
    return text;
}

function normalizeCompetitionLabel(value) {
    return normalizeSearchTopic(expandCommonCompetitionAliases(String(value || '').replace(/\b(history|all time)\b/gi, ' ')));
}

function buildGroundedAnswer({ query, results, strictCurrentRoleLookup }) {
    const cleanQuery = normalizeQuery(query);
    if (!cleanQuery || !Array.isArray(results) || !results.length) return '';

    const evidence = buildEvidenceUnits(results);
    if (!evidence.length) return '';

    const domain = detectQueryDomain(cleanQuery);

    if (strictCurrentRoleLookup) {
        const roleAnswer = buildRoleAnswer(cleanQuery, evidence);
        if (roleAnswer) return roleAnswer;
    }

    const numericAnswer = buildNumericConsensusAnswer(cleanQuery, evidence, domain);
    if (numericAnswer) return numericAnswer;

    const directAnswer = buildDirectDescriptiveAnswer(cleanQuery, evidence);
    if (directAnswer) return directAnswer;

    const fallback = evidence.find((item) => item.bestSentence)?.bestSentence || evidence[0]?.summary || '';
    return cleanupAnswerText(fallback);
}

function buildEvidenceUnits(results) {
    return results
        .map((item) => {
            const title = normalizeWhitespace(item?.title || '');
            const description = normalizeWhitespace(item?.description || '');
            const url = normalizeWhitespace(item?.url || '');
            const summary = [title, description].filter(Boolean).join('. ');
            const sentences = splitSentences([title, description].filter(Boolean).join('. '));
            const bestSentence = sentences.find(Boolean) || summary;

            return {
                title,
                description,
                url,
                summary,
                sentences,
                bestSentence,
                domain: extractDomainFromUrl(url)
            };
        })
        .filter((item) => item.summary);
}

function buildRoleAnswer(query, evidence) {
    const roleLabel = extractRoleFromQuery(query);
    if (!roleLabel) return '';

    const preferred = evidence.find((item) => /reuters|bloomberg|investor|leadership|management|official/i.test(item.summary));
    const source = preferred || evidence[0];
    if (!source) return '';

    const sentence = source.sentences.find((line) => new RegExp(`\\b${escapeRegExp(roleLabel)}\\b`, 'i').test(line)) || source.bestSentence;
    return cleanupAnswerText(sentence);
}

// Keep final numeric answers concise: one grounded sentence only.
function buildNumericConsensusAnswer(query, evidence, domain = 'general') {
    if (!/\b(how many|total|number of)\b/i.test(query)) return '';

    const counts = new Map();
    const examples = new Map();
    const queryContext = buildNumericQueryContext(query, domain);

    for (const item of evidence.slice(0, 6)) {
        const normalizedNumbers = extractCandidateNumbers(item.summary, queryContext);
        for (const entry of normalizedNumbers) {
            const key = String(entry.value);
            counts.set(key, (counts.get(key) || 0) + entry.weight);
            if (!examples.has(key) || entry.weight > 2) {
                examples.set(key, entry.sentence || item.bestSentence);
            }
        }
    }

    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return '';

    const [topValue, topScore] = ranked[0];
    const secondScore = ranked[1]?.[1] || 0;

    const threshold = queryContext.domain === 'sports' ? 1.5 : 2;
    const ratioThreshold = queryContext.domain === 'sports' ? 1.05 : 1.2;

    if (topScore < threshold || topScore < secondScore * ratioThreshold) {
        return queryContext.domain === 'sports'
            ? buildSportsAchievementFallback(query, evidence, queryContext)
            : '';
    }

    const subject = deriveQuerySubject(query);
    const normalizedValue = normalizeNumericPhrase(topValue);
    const measure = deriveMeasureFromQuery(query);
    const qualifier = deriveContextFromQuery(query);

    const parts = [];
    if (subject) {
        parts.push(`${subject} ${measure ? `has ${measure}` : 'has'} ${normalizedValue}`);
    } else if (measure) {
        parts.push(`The answer appears to be ${normalizedValue} ${measure}`);
    } else {
        parts.push(`The answer appears to be ${normalizedValue}`);
    }

    if (qualifier) {
        parts[0] += ` ${qualifier}`;
    }

    return `${parts[0]}.`;
}

function buildNumericQueryContext(query, domain) {
    const normalizedQuery = normalizeQuery(query);
    const subjectTokens = tokenizeMeaningfulWords(query);
    const measureMatch = normalizedQuery.match(/\b(cups|titles|trophies|championships|wins|races|grand prix|victories|rings|medals)\b/i);

    return {
        domain,
        query: normalizedQuery,
        subjectTokens,
        targetMeasure: measureMatch ? normalizeAchievementLabel(measureMatch[1]) : '',
        prefersAchievementCount: domain === 'sports' || SPORTS_ACHIEVEMENT_PATTERN.test(normalizedQuery)
    };
}

// Sports fallback should also stay concise and avoid extra interpretation.
function buildSportsAchievementFallback(query, evidence, queryContext) {
    const rankedSentences = [];

    for (const item of evidence.slice(0, 6)) {
        for (const sentence of item.sentences) {
            const extracted = extractCandidateNumbers(sentence, queryContext);
            if (!extracted.length) continue;

            const score =
                extracted.reduce((acc, entry) => acc + entry.weight, 0) +
                scoreSentenceAgainstQuery(sentence, queryContext.subjectTokens);

            rankedSentences.push({
                sentence,
                score,
                value: extracted.sort((a, b) => b.weight - a.weight)[0]?.value
            });
        }
    }

    rankedSentences.sort((a, b) => b.score - a.score);
    const best = rankedSentences[0];
    if (!best || best.score < 1.5 || best.value == null) return '';

    const subject = deriveQuerySubject(query);
    const measure = deriveMeasureFromQuery(query);
    const qualifier = deriveContextFromQuery(query);
    const normalizedValue = normalizeNumericPhrase(best.value);

    const base = subject
        ? `${subject} ${measure ? `has ${measure}` : 'has'} ${normalizedValue}`
        : `The answer appears to be ${normalizedValue}`;

    return `${base}${qualifier ? ` ${qualifier}` : ''}.`;
}

function buildDirectDescriptiveAnswer(query, evidence) {
    const patterns = [
        /\bwho(?:'s| is)?\b/i,
        /\bwhat(?:'s| is)?\b/i,
        /\bwhen\b/i,
        /\bwhere\b/i,
        /\bwhich\b/i,
        /\bwhy\b/i,
        /\bhow\b/i
    ];

    if (!patterns.some((pattern) => pattern.test(query))) {
        return '';
    }

    const subjectTokens = tokenizeMeaningfulWords(query);
    const rankedSentences = [];

    for (const item of evidence.slice(0, 5)) {
        for (const sentence of item.sentences) {
            const score = scoreSentenceAgainstQuery(sentence, subjectTokens);
            if (score > 0) {
                rankedSentences.push({ sentence, score });
            }
        }
    }

    rankedSentences.sort((a, b) => b.score - a.score);
    const best = rankedSentences[0]?.sentence || evidence[0]?.bestSentence || '';
    return cleanupAnswerText(best);
}

function extractCandidateNumbers(text, options = {}) {
    const sentences = splitSentences(text);
    const out = [];

    for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        const hasAchievementSignal =
            ACHIEVEMENT_KEYWORD_PATTERN.test(lowerSentence) ||
            (options.targetMeasure && lowerSentence.includes(options.targetMeasure.toLowerCase()));

        if (options.prefersAchievementCount && ZERO_ACHIEVEMENT_PATTERN.test(lowerSentence)) {
            out.push({
                value: '0',
                sentence,
                weight: hasAchievementSignal ? 4 : 3
            });
        }

        const numericMatches = sentence.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g) || [];
        for (const match of numericMatches) {
            const cleanValue = match.replace(/,/g, '');
            let weight = /\b(total|times|titles|trophies|championships|wins|seasons|cups|races|victories|episodes|years|medals|rings|trophy)\b/i.test(sentence) ? 2 : 1;

            if (options.prefersAchievementCount && hasAchievementSignal) {
                weight += 2;
            }

            if (options.prefersAchievementCount && YEAR_NUMBER_PATTERN.test(cleanValue)) {
                weight -= 2;
            }

            if (options.prefersAchievementCount && /\b(final|finals|runner-up|season|edition)\b/i.test(sentence) && !hasAchievementSignal) {
                weight -= 1;
            }

            if (weight <= 0) continue;

            out.push({
                value: cleanValue,
                sentence,
                weight
            });
        }

        const wordNumberMatches = sentence.match(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:[-\s]time)?/gi) || [];
        for (const match of wordNumberMatches) {
            const parsed = wordToNumber(match);
            if (parsed != null) {
                let weight = /\b(total|times|titles|trophies|championships|wins|seasons|cups|races|victories|episodes|years|medals|rings|trophy)\b/i.test(sentence) ? 2 : 1;

                if (options.prefersAchievementCount && hasAchievementSignal) {
                    weight += 2;
                }

                out.push({
                    value: String(parsed),
                    sentence,
                    weight
                });
            }
        }
    }

    return out;
}

function deriveQuerySubject(query) {
    const cleaned = normalizeQuery(query)
        .replace(/^how many\s+.+?\s+did\s+/i, '')
        .replace(/^how many\s+.+?\s+has\s+/i, '')
        .replace(/^number of\s+.+?\s+for\s+/i, '')
        .replace(/^total\s+.+?\s+for\s+/i, '')
        .replace(/\s+(win|won|have|has)\b.*$/i, '')
        .replace(/\b(in|at|for)\b.*$/i, '')
        .trim();

    return cleaned ? preserveEntityCasing(cleaned) : '';
}

function deriveMeasureFromQuery(query) {
    const match = normalizeQuery(query).match(/\b(cups|titles|trophies|championships|wins|races|victories|rings|medals|seasons|episodes|years)\b/i);
    if (!match) return '';
    const word = match[1].toLowerCase();
    if (word === 'cups') return 'won';
    if (word === 'titles' || word === 'trophies' || word === 'championships' || word === 'wins' || word === 'races' || word === 'victories' || word === 'rings' || word === 'medals') {
        return `won ${word}`;
    }
    return `has ${word}`;
}

function deriveContextFromQuery(query) {
    const match = normalizeQuery(query).match(/\b(in|at|for)\s+(.+)$/i);
    if (!match?.[2]) return '';
    return `${match[1].toLowerCase()} ${normalizeSearchTopic(match[2])}`;
}

function normalizeNumericPhrase(value) {
    return String(value || '').trim();
}

function tokenizeMeaningfulWords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'did', 'do', 'does', 'has', 'have', 'had', 'in', 'on', 'of', 'for', 'to', 'my', 'your', 'their', 'his', 'her', 'how', 'many', 'what', 'when', 'where', 'who', 'which', 'why', 'now', 'right', 'current', 'latest', 'history', 'all', 'time', 'total']);
    return normalizeQuery(text)
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token && !stopWords.has(token));
}

function scoreSentenceAgainstQuery(sentence, tokens) {
    const lowered = String(sentence || '').toLowerCase();
    let score = 0;
    for (const token of tokens) {
        if (lowered.includes(token)) score += 1;
    }
    if (/\b(is|was|are|were|won|winner|founded|located|based|appointed|became)\b/i.test(sentence)) score += 0.5;
    return score;
}

function splitSentences(text) {
    return normalizeWhitespace(text)
        .split(SENTENCE_SPLIT_PATTERN)
        .map((part) => cleanupAnswerText(part))
        .filter(Boolean);
}

function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanupAnswerText(text) {
    return normalizeWhitespace(text)
        .replace(/^[-–•:\s]+/, '')
        .replace(/\s+([,.!?;:])/g, '$1')
        .trim();
}

function extractDomainFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

function wordToNumber(value) {
    const map = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12
    };

    const key = String(value || '').toLowerCase().replace(/[-\s]time$/, '').trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function preserveEntityCasing(text) {
    return String(text || '')
        .split(/\s+/)
        .map((part) => {
            if (/^[A-Z0-9&.-]+$/.test(part)) return part;
            if (/^[a-z0-9&.-]+$/.test(part) && part.length <= 5) return part.toUpperCase();
            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(' ');
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
