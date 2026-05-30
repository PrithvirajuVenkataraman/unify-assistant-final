export const config = { maxDuration: 60 };

import { applyApiSecurity } from './security.js';
import { searchSerper, searchGoogleNewsRss, getDomainFromUrl } from './search.js';

const RESULT_SOURCE_RE = /\b(result|scorecard|highlights?|match report|post[- ]match|who won|yesterday'?s?|beat|defeat(?:ed)?|won by|lost to|crush(?:ed)?|storm(?:ed)?|chase(?:d)?|advanced?|qualified?)\b/i;
const WEAK_SOURCE_RE = /\b(preview|prediction|predict|pitch report|weather|rain|washed out|washout|what happens if|schedule|fixtures?|live scores?|points table|standings|probable xi|playing 11|fantasy|dream11|odds)\b/i;

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'current-facts',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const query = String(req.body?.query || '').trim();
    if (!query) {
        return res.status(400).json({ success: false, error: 'query is required' });
    }

    try {
        const result = await resolveCurrentFact(query);
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return res.status(200).json({
            success: false,
            resolved: false,
            error: String(error?.message || error || 'current fact resolution failed'),
            answer: '',
            sources: []
        });
    }
}

async function resolveCurrentFact(query) {
    const intent = classifyCurrentFact(query);
    const searchQueries = buildResolverQueries(query, intent);
    const sources = await collectSources(searchQueries, intent);
    const ranked = rankFactSources(sources, intent).slice(0, 8);

    let resolved = null;
    if (intent.domain === 'sports') {
        resolved = await resolveSportsFact(query, ranked, intent);
    } else if (intent.factType === 'role') {
        resolved = resolveRoleFact(query, ranked, intent);
    } else {
        resolved = resolveEventFact(query, ranked, intent);
    }

    if (resolved?.answer) {
        return {
            resolved: true,
            domain: intent.domain,
            factType: intent.factType,
            answer: resolved.answer,
            asOf: new Date().toISOString(),
            confidence: resolved.confidence || 'medium',
            provider: resolved.provider || 'structured_web_resolver',
            sources: resolved.sources || ranked.slice(0, 5),
            debug: {
                searchQueries,
                sourceCount: ranked.length,
                sourceCategories: ranked.slice(0, 8).map(item => ({
                    title: item.title,
                    domain: getDomainFromUrl(item.url),
                    category: classifySourceCategory(item)
                })),
                extractionReason: resolved.reason || ''
            }
        };
    }

    return {
        resolved: false,
        domain: intent.domain,
        factType: intent.factType,
        answer: '',
        asOf: new Date().toISOString(),
        confidence: 'low',
        provider: 'structured_web_resolver',
        sources: ranked.slice(0, 5),
        debug: {
            searchQueries,
            sourceCount: ranked.length,
            sourceCategories: ranked.slice(0, 8).map(item => ({
                title: item.title,
                domain: getDomainFromUrl(item.url),
                category: classifySourceCategory(item)
            })),
            extractionReason: ranked.length ? 'no concrete structured fact extracted' : 'no sources returned'
        }
    };
}

function classifyCurrentFact(query) {
    const t = query.toLowerCase();
    const isSports = /\b(ipl|cricket|match|score|scores|fixture|fixtures|league|tournament|world cup|icc|bcci|nba|nfl|mlb|nhl|football|soccer|tennis|f1|formula 1)\b/.test(t);
    const isRole = /\b(current|who is|who's|ceo|president|prime minister|pm|chair(?:man|person)?|captain|coach|founder|head of|leader of|director)\b/.test(t) &&
        /\b(ceo|president|prime minister|pm|chair(?:man|person)?|captain|coach|founder|head of|leader of|director)\b/.test(t);
    const isMarket = /\b(price|stock|share|bitcoin|crypto|gold|silver|market cap|exchange rate|usd|inr|eur|gbp)\b/.test(t);
    const isSpace = /\b(isro|nasa|esa|spacex|launch|mission|satellite|rocket)\b/.test(t);
    const isEntertainment = /\b(movie|film|song|album|release|ott|netflix|prime video|disney)\b/.test(t);
    if (isSports) {
        return {
            domain: 'sports',
            factType: /\b(score|result|won|winner|what happened|latest)\b/.test(t) ? 'result' : 'sports_status'
        };
    }
    if (isRole) return { domain: 'roles', factType: 'role' };
    if (isMarket) return { domain: 'markets', factType: 'price' };
    if (isSpace) return { domain: 'space_science', factType: 'status' };
    if (isEntertainment) return { domain: 'entertainment', factType: 'release' };
    return { domain: 'news', factType: 'event' };
}

function buildResolverQueries(query, intent) {
    const raw = String(query || '').trim();
    const year = new Date().getFullYear();
    if (intent.domain === 'sports' && /\b(ipl|indian premier league)\b/i.test(raw)) {
        return [
            `who won yesterday IPL match ${year} result score`,
            `yesterday IPL ${year} match result who won scorecard`,
            `latest IPL ${year} match result who won`,
            `IPL ${year} last match result who won score`,
            `IPL ${year} latest match result scorecard`,
            `latest IPL match result score Cricbuzz ESPNcricinfo`,
            `IPL latest match result today yesterday scorecard`,
            `site:iplt20.com IPL ${year} latest match result`,
            `site:espncricinfo.com IPL ${year} latest match result`,
            `site:cricbuzz.com IPL ${year} latest match result`,
            `site:rajasthanroyals.com IPL ${year} match report result`,
            raw
        ];
    }
    if (intent.domain === 'sports') {
        return [
            `${raw} result scorecard`,
            `${raw} match report highlights`,
            raw
        ];
    }
    if (intent.factType === 'role') {
        return [
            `${raw} official`,
            `${raw} current official profile`,
            `${raw} Reuters OR AP OR BBC`,
            raw
        ];
    }
    return [
        raw,
        `${raw} latest update official`,
        `${raw} Reuters OR AP OR BBC`
    ];
}

async function collectSources(queries, intent) {
    const seen = new Set();
    const out = [];
    for (const q of queries.slice(0, 6)) {
        const rssResults = await searchGoogleNewsRss(q, { maxResults: 6, timeoutMs: 6500 }).catch(() => []);
        addUniqueSources(out, seen, rssResults);
        if (out.length >= 10) return out;

        const serperResults = await searchSerper(q, { maxResults: 4, timeoutMs: 6500 }).catch(() => []);
        addUniqueSources(out, seen, serperResults);
        if (out.length >= 18) return out;
    }
    return out;
}

function addUniqueSources(out, seen, items) {
    for (const item of Array.isArray(items) ? items : []) {
        const url = String(item?.url || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
            title: cleanText(item.title),
            url,
            description: cleanText(item.description),
            date: cleanText(item.date || item.publishedAt || ''),
            provider: item.provider || 'search'
        });
    }
}

function rankFactSources(sources, intent) {
    return [...(Array.isArray(sources) ? sources : [])]
        .map((item, index) => {
            const combined = `${item.title} ${item.description}`;
            const host = getDomainFromUrl(item.url);
            let score = 0;
            if (RESULT_SOURCE_RE.test(combined)) score += 10;
            if (WEAK_SOURCE_RE.test(combined)) score -= 12;
            if (intent.domain === 'sports' && /\b(iplt20\.com|espncricinfo\.com|cricbuzz\.com|bcci\.tv|icc-cricket\.com|rajasthanroyals\.com|gujarattitansipl\.com)\b/i.test(host)) score += 8;
            if (/\b(reuters\.com|apnews\.com|bbc\.com|thehindu\.com|indianexpress\.com|economictimes\.indiatimes\.com|ndtv\.com|sportstar\.thehindu\.com)\b/i.test(host)) score += 5;
            if (item.provider === 'google_news_rss') score += 1;
            score -= index * 0.01;
            return { ...item, __score: score };
        })
        .sort((a, b) => b.__score - a.__score)
        .map(({ __score, ...item }) => item);
}

function classifySourceCategory(source) {
    const combined = `${source?.title || ''} ${source?.description || ''}`;
    if (WEAK_SOURCE_RE.test(combined)) return 'weak_preview_or_context';
    if (RESULT_SOURCE_RE.test(combined)) return 'post_event_result';
    if (/\blive\b/i.test(combined)) return 'liveblog';
    return 'general_report';
}

async function resolveSportsFact(query, sources, intent) {
    const candidates = sources
        .filter(item => classifySourceCategory(item) !== 'weak_preview_or_context')
        .map(item => ({ item, extracted: extractSportsResult(`${item.title}. ${item.description}`) }))
        .filter(row => row.extracted?.answer);
    if (!candidates.length) {
        const hydrated = await hydrateSportsResultFromPages(sources);
        if (hydrated?.extracted?.answer) {
            return {
                answer: hydrated.extracted.answer,
                confidence: 'medium',
                provider: 'sports_page_result_extractor',
                sources: [hydrated.item, ...sources.filter(item => item.url !== hydrated.item.url)].slice(0, 5),
                reason: hydrated.extracted.reason || 'sports result extracted from fetched page text'
            };
        }
        return null;
    }

    const best = candidates[0];
    return {
        answer: best.extracted.answer,
        confidence: candidates.length >= 2 ? 'high' : 'medium',
        provider: 'sports_result_extractor',
        sources: [best.item, ...sources.filter(item => item.url !== best.item.url)].slice(0, 5),
        reason: best.extracted.reason || 'sports result extracted from post-event source'
    };
}

async function hydrateSportsResultFromPages(sources) {
    const candidates = (Array.isArray(sources) ? sources : [])
        .filter(item => classifySourceCategory(item) !== 'weak_preview_or_context' || RESULT_SOURCE_RE.test(`${item.title} ${item.description}`))
        .slice(0, 5);
    for (const item of candidates) {
        const pageText = await fetchReadablePageText(item.url).catch(() => '');
        if (!pageText) continue;
        const extracted = extractSportsResult(`${item.title}. ${item.description}. ${pageText}`);
        if (extracted?.answer) return { item, extracted };
    }
    return null;
}

async function fetchReadablePageText(url) {
    const value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5500);
    try {
        const response = await fetch(value, {
            headers: {
                'User-Agent': 'Mozilla/5.0 UnifyAssistant/1.0',
                Accept: 'text/html,application/xhtml+xml'
            },
            signal: controller.signal
        });
        if (!response.ok) return '';
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) return '';
        const html = await response.text();
        return htmlToSearchableText(html).slice(0, 9000);
    } finally {
        clearTimeout(timeoutId);
    }
}

function htmlToSearchableText(html) {
    return cleanText(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']+)["'][^>]*>/gi, ' $1 ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'"));
}

function extractSportsResult(text) {
    const clean = cleanText(text);
    if (!clean) return null;

    const wonBy = clean.match(/\b([A-Z][A-Za-z .&'-]{2,40}?)\s+(?:beat|defeated|crushed|downed|won against|stormed past|produced .*? to defeat)\s+([A-Z][A-Za-z .&'-]{2,40}?)\s+by\s+([^.;]+)/i);
    if (wonBy) {
        const winner = tidyEntity(wonBy[1]);
        const loser = tidyEntity(wonBy[2]);
        const margin = cleanText(wonBy[3]).replace(/\s+with\s+.*$/i, '');
        const scores = extractCricketScores(clean);
        return {
            answer: `${winner} beat ${loser} by ${margin}.${scores ? ` ${scores}` : ''}`,
            reason: 'beat/defeated pattern'
        };
    }

    const victoryOver = clean.match(/\b([A-Z][A-Za-z .&'-]{2,40}?)\s+(?:[^.;]{0,80}?\s)?(?:win|wins|victory|defeat|defeated)\s+(?:by\s+([^.;]{2,60}?)\s+)?(?:over|against)\s+([A-Z][A-Za-z .&'-]{2,40}?)(?:[.;,]|$)/i);
    if (victoryOver) {
        const winner = tidyEntity(victoryOver[1]);
        const loser = tidyEntity(victoryOver[3]);
        const margin = victoryOver[2] ? cleanText(victoryOver[2]).replace(/\s+with\s+.*$/i, '') : '';
        const scores = extractCricketScores(clean);
        return {
            answer: `${winner} beat ${loser}${margin ? ` by ${margin}` : ''}.${scores ? ` ${scores}` : ''}`,
            reason: 'victory-over pattern'
        };
    }

    const defeatWithVictory = clean.match(/\b([A-Z][A-Za-z .&'-]{2,40}?)\s+[^.;]{0,100}?\bdefeat(?:ed)?\s+([A-Z][A-Za-z .&'-]{2,40}?)\s+[^.;]{0,100}?\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)[-\s]wicket|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)[-\s]run)[-\s]victory\b/i);
    if (defeatWithVictory) {
        const winner = tidyEntity(defeatWithVictory[1]);
        const loser = tidyEntity(defeatWithVictory[2]);
        const margin = cleanText(defeatWithVictory[3]).replace(/-/g, ' ');
        const scores = extractCricketScores(clean);
        return {
            answer: `${winner} beat ${loser} by ${margin}s.${scores ? ` ${scores}` : ''}`,
            reason: 'defeat-with-victory-margin pattern'
        };
    }

    const aliasWonBy = clean.match(/\b([A-Z]{2,4})\s+won\s+by\s+([^.;]+)/);
    if (aliasWonBy) {
        const winner = expandTeamAlias(aliasWonBy[1], clean);
        const loser = inferOpponentAlias(aliasWonBy[1], clean);
        const margin = cleanText(aliasWonBy[2]).replace(/\s+with\s+.*$/i, '');
        const scores = extractCricketScores(clean);
        return {
            answer: `${winner}${loser ? ` beat ${loser}` : ' won'} by ${margin}.${scores ? ` ${scores}` : ''}`,
            reason: 'team-code won-by pattern'
        };
    }

    const lostTo = clean.match(/\b([A-Z][A-Za-z .&'-]{2,40}?)\s+\d{2,3}\/\d[^.]{0,120}?\blost to\s+([A-Z][A-Za-z .&'-]{2,40}?)\s+\d{2,3}\/\d[^.]{0,80}?\s+by\s+([^.;]+)/i);
    if (lostTo) {
        const loser = tidyEntity(lostTo[1]);
        const winner = tidyEntity(lostTo[2]);
        const margin = cleanText(lostTo[3]).replace(/\s+with\s+.*$/i, '');
        const scores = extractCricketScores(clean);
        return {
            answer: `${winner} beat ${loser} by ${margin}.${scores ? ` ${scores}` : ''}`,
            reason: 'lost-to pattern'
        };
    }

    const winnerOnly = clean.match(/\b([A-Z][A-Za-z .&'-]{2,40}?)\s+(?:advanced?|qualified|stormed into|booked .*? place).*?\b(?:final|next round)\b/i);
    if (winnerOnly && /\bbeat|defeat|won by|victory\b/i.test(clean)) {
        const scores = extractCricketScores(clean);
        return {
            answer: `${tidyEntity(winnerOnly[1])} advanced after the latest match.${scores ? ` ${scores}` : ''}`,
            reason: 'qualification pattern'
        };
    }

    return null;
}

function expandTeamAlias(alias, context = '') {
    const code = String(alias || '').toUpperCase();
    const map = {
        GT: 'Gujarat Titans',
        RR: 'Rajasthan Royals',
        RCB: 'Royal Challengers Bengaluru',
        MI: 'Mumbai Indians',
        CSK: 'Chennai Super Kings',
        KKR: 'Kolkata Knight Riders',
        SRH: 'Sunrisers Hyderabad',
        DC: 'Delhi Capitals',
        PBKS: 'Punjab Kings',
        LSG: 'Lucknow Super Giants'
    };
    if (map[code]) return map[code];
    return code;
}

function inferOpponentAlias(winnerAlias, context = '') {
    const winner = String(winnerAlias || '').toUpperCase();
    const aliases = ['GT', 'RR', 'RCB', 'MI', 'CSK', 'KKR', 'SRH', 'DC', 'PBKS', 'LSG'];
    const found = aliases.filter(alias => alias !== winner && new RegExp(`\\b${alias}\\b`).test(context));
    return found[0] ? expandTeamAlias(found[0], context) : '';
}

function extractCricketScores(text) {
    const matches = Array.from(cleanText(text).matchAll(/\b([A-Z]{2,4}|[A-Z][A-Za-z ]{2,24})\s+(\d{2,3}\/\d)\s+(?:in\s+)?(\d{1,2}(?:\.\d)?)(?:\/20)?\s*overs?/gi));
    if (matches.length >= 2) {
        return matches.slice(0, 2).map(m => `${tidyEntity(m[1])} ${m[2]} in ${m[3]} overs`).join('; ') + '.';
    }
    const compact = Array.from(cleanText(text).matchAll(/\b([A-Z]{2,4})\s+(\d{2,3}\/\d)\b/g));
    if (compact.length >= 2) {
        return compact.slice(0, 2).map(m => `${m[1]} ${m[2]}`).join('; ') + '.';
    }
    return '';
}

function resolveRoleFact(query, sources, intent) {
    const usable = sources.filter(item => classifySourceCategory(item) !== 'weak_preview_or_context');
    for (const item of usable) {
        const combined = `${item.title}. ${item.description}`;
        const extracted = extractRoleAnswer(query, combined);
        if (extracted) {
            return {
                answer: extracted,
                confidence: 'medium',
                provider: 'role_fact_extractor',
                sources: [item, ...usable.filter(other => other.url !== item.url)].slice(0, 5),
                reason: 'role holder extracted from authoritative/current source'
            };
        }
    }
    return null;
}

function extractRoleAnswer(query, text) {
    const roleMatch = query.match(/\b(ceo|president|prime minister|pm|chair(?:man|person)?|captain|coach|founder|head of|leader of|director)\b/i);
    if (!roleMatch) return '';
    const role = roleMatch[1].toLowerCase();
    const name = '([A-Z][A-Za-z.\'-]+(?:\\s+[A-Z][A-Za-z.\'-]+){0,4})';
    const patterns = [
        new RegExp(`\\b${name}\\b\\s+(?:is|was|serves as|has been named)\\s+(?:the\\s+)?(?:current\\s+)?${escapeRegex(role)}\\b`, 'i'),
        new RegExp(`\\b(?:current\\s+)?${escapeRegex(role)}\\b[^.]{0,80}?\\b(?:is|:|-)\\s*${name}`, 'i')
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return `The current ${role} appears to be ${match[1].trim()}.`;
    }
    return '';
}

function resolveEventFact(query, sources, intent) {
    const usable = sources.filter(item => classifySourceCategory(item) !== 'weak_preview_or_context');
    const top = usable[0] || sources[0];
    if (!top) return null;
    const sentence = cleanText(top.description || top.title);
    if (!sentence) return null;
    return {
        answer: sentence.length > 260 ? `${sentence.slice(0, 257).trim()}...` : sentence,
        confidence: usable.length ? 'medium' : 'low',
        provider: 'authoritative_search_summary',
        sources: [top, ...sources.filter(item => item.url !== top.url)].slice(0, 5),
        reason: usable.length ? 'top non-preview source selected' : 'only weak/general sources available'
    };
}

function tidyEntity(value) {
    return cleanText(value)
        .replace(/\b(in|the|a|an|and|to|with|from|after|against|for|of)$/i, '')
        .replace(/^(in|the|a|an)\s+/i, '')
        .trim();
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
