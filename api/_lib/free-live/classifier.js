const ROUTES = Object.freeze(['llm', 'cached_latest', 'live_required', 'clarify']);

const CATEGORY_PATTERNS = Object.freeze([
    {
        category: 'weather',
        route: 'live_required',
        reason: 'weather_requires_live_source',
        pattern: /\b(weather|temperature|forecast|rain|snow|storm|humidity|wind|uv index)\b/i
    },
    {
        category: 'crypto',
        route: 'live_required',
        reason: 'crypto_price_requires_live_source',
        pattern: /\b(crypto|bitcoin|btc|ethereum|eth|solana|dogecoin)\b.*\b(price|now|today|live|current|rate)\b|\b(price|rate|quote)\b.*\b(bitcoin|btc|ethereum|eth|crypto)\b/i
    },
    {
        category: 'sports',
        route: 'live_required',
        reason: 'sports_updates_require_live_source',
        pattern: /\b(live scores?|score now|match score|game score|fixtures?|standings|sports news|ipl|nba|nfl|epl|premier league|cricket|football|soccer|tennis)\b/i
    },
    {
        category: 'disasters',
        route: 'live_required',
        reason: 'disaster_updates_require_live_source',
        pattern: /\b(earthquake|wildfire|flood|cyclone|hurricane|typhoon|tsunami|volcano|landslide|natural disaster|calamity|emergency alert)\b/i
    },
    {
        category: 'government',
        route: 'live_required',
        reason: 'government_current_fact_requires_public_source',
        pattern: /\b(government|govt|ministry|minister|president|prime minister|chief minister|governor|mayor|election|parliament|assembly|official announcement|public advisory)\b/i
    },
    {
        category: 'tourism_food_places',
        route: 'live_required',
        reason: 'place_or_travel_request_needs_location_source',
        pattern: /\b(tourism|tourist|travel|places to visit|attractions?|temple|museum|hotel|where am i|where i am)\b/i
    },
    {
        category: 'news',
        route: 'cached_latest',
        reason: 'freshness_news_query',
        pattern: /\b(latest|recent|new|newest|today'?s|this week|current|breaking)\b.*\b(news|announcement|announcements|release|releases|changelog|updates?|papers?|blog posts?)\b|\b(news|announcements|releases|changelog|updates?|papers?|blog posts?)\b.*\b(latest|recent|new|newest|today'?s|this week|current|breaking)\b/i
    }
]);

const LLM_PATTERNS = Object.freeze([
    /\b(explain|what is|define|definition|meaning of|how does|why does)\b/i,
    /\b(code|coding|debug|debugging|bug|error|stack trace|function|api|typescript|javascript|python)\b/i,
    /\b(math|solve|calculate|equation|proof|grammar|rewrite|summarize)\b/i,
    /\b(science concept|physics|chemistry|biology|history|music theory|chords?|guitar strings?)\b/i,
    /\b(story|poem|creative writing|draft|write a)\b/i
]);

const UNSUPPORTED_FREE_LIVE_PATTERNS = Object.freeze([
    /\b(available now|in stock)\b/i,
    /\b(hotels?|pharmacy|gas station|store)\b.*\b(near me|open now|best|reviews?|rating)\b/i,
    /\b(stock|share price|ticker|market price|quote)\b.*\b(now|today|live|current|exact)\b/i
]);

export function classifyFreeLiveIntent(message) {
    const text = normalizeMessage(message);
    if (!text) return strictRoute('clarify', 'clarify', 0.2, ['empty_message']);

    for (const pattern of UNSUPPORTED_FREE_LIVE_PATTERNS) {
        if (pattern.test(text)) {
            return strictRoute('live_required', 'unsupported_free_live', 0.82, ['no_durable_free_source']);
        }
    }

    for (const entry of CATEGORY_PATTERNS) {
        if (entry.pattern.test(text)) {
            return strictRoute(entry.route, entry.category, 0.86, [entry.reason]);
        }
    }

    const llmScore = scorePatterns(text, LLM_PATTERNS, 0.28);
    if (llmScore >= 0.28) {
        return strictRoute('llm', 'stable_knowledge', Math.min(0.9, Math.max(0.42, llmScore)), ['default_or_stable_knowledge']);
    }
    return strictRoute('llm', 'stable_knowledge', 0.42, ['default_or_stable_knowledge']);
}

export function routeMessage(message) {
    const route = classifyFreeLiveIntent(message);
    return {
        route: route.route,
        confidence: route.confidence,
        reasons: route.reasons
    };
}

function strictRoute(route, category, confidence, reasons) {
    const normalizedRoute = ROUTES.includes(route) ? route : 'clarify';
    return {
        route: normalizedRoute,
        category: String(category || normalizedRoute),
        confidence: Number(confidence.toFixed(2)),
        reasons: Array.isArray(reasons) ? reasons.map(String).slice(0, 4) : []
    };
}

function scorePatterns(text, patterns, weight) {
    let score = 0;
    for (const pattern of patterns) {
        if (pattern.test(text)) score += weight;
    }
    return Math.min(1, score);
}

function normalizeMessage(message) {
    return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export const __test = {
    CATEGORY_PATTERNS,
    UNSUPPORTED_FREE_LIVE_PATTERNS,
    scorePatterns
};
