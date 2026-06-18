const ROUTES = Object.freeze(['llm', 'cached_latest', 'live_required', 'clarify']);

const LIVE_REQUIRED_PATTERNS = Object.freeze([
    /\b(weather|temperature|forecast|rain|snow|storm)\b/i,
    /\b(stock|share price|market price|quote|ticker)\b/i,
    /\b(crypto|bitcoin|btc|ethereum|eth)\b.*\b(price|now|today|live)\b/i,
    /\b(price|rate|quote)\b.*\b(now|today|live|current|exact)\b/i,
    /\b(live scores?|score now|match score|game score)\b/i,
    /\b(near me|open now|available now|availability|in stock)\b/i,
    /\b(restaurants?|cafes?|hotels?|pharmacy|gas station|store)\b.*\b(near me|open now)\b/i
]);

const CACHED_LATEST_PATTERNS = Object.freeze([
    /\b(latest|recent|new|newest|today'?s|this week|current)\b.*\b(news|announcement|announcements|release|releases|changelog|updates?|papers?|blog posts?)\b/i,
    /\b(news|announcements|releases|changelog|updates?|papers?|blog posts?)\b.*\b(latest|recent|new|newest|today'?s|this week|current)\b/i,
    /\b(latest|recent|new|newest)\b.*\b(openai|anthropic|vercel|next\.?js|react|hacker news|arxiv)\b/i,
    /\b(company updates?|framework updates?|recent papers?)\b/i
]);

const LLM_PATTERNS = Object.freeze([
    /\b(explain|what is|define|definition|meaning of|how does|why does)\b/i,
    /\b(code|coding|debug|debugging|bug|error|stack trace|function|api|typescript|javascript|python)\b/i,
    /\b(math|solve|calculate|equation|proof|grammar|rewrite|summarize)\b/i,
    /\b(science concept|physics|chemistry|biology|history|music theory|chords?|guitar strings?)\b/i,
    /\b(story|poem|creative writing|draft|write a)\b/i
]);

export function routeMessage(message) {
    const text = normalizeMessage(message);
    if (!text) {
        return strictRoute('clarify', 0.2, ['empty_message']);
    }

    const liveScore = scorePatterns(text, LIVE_REQUIRED_PATTERNS, 0.35);
    const cachedScore = scorePatterns(text, CACHED_LATEST_PATTERNS, 0.35);
    const llmScore = Math.max(0.42, scorePatterns(text, LLM_PATTERNS, 0.28));

    if (liveScore >= 0.35 && liveScore > cachedScore) {
        return strictRoute('live_required', Math.min(0.98, liveScore), ['requires_real_time_source']);
    }
    if (cachedScore >= 0.35 && cachedScore > liveScore) {
        return strictRoute('cached_latest', Math.min(0.96, cachedScore), ['freshness_cache_match']);
    }
    if (llmScore >= 0.42) {
        return strictRoute('llm', Math.min(0.9, llmScore), ['default_or_stable_knowledge']);
    }
    return strictRoute('clarify', 0.35, ['routing_unclear']);
}

export function routeMessageJson(message) {
    return JSON.stringify(routeMessage(message));
}

function strictRoute(route, confidence, reasons) {
    const normalizedRoute = ROUTES.includes(route) ? route : 'clarify';
    return {
        route: normalizedRoute,
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
    ROUTES,
    scorePatterns
};
