const PLACE_TYPE_PATTERN = /\b(museum|museums|temple|park|beach|fort|palace|landmark|attraction|attractions|restaurant|hotel|hotels)\b/i;

export function normalizePlaceTopic(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .replace(/\b(?:the|a|an|near|nearby|in|at|of|for|to|visit|places|place|best|top|around|open|now|please|show|find)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function scorePlaceEvidence(query, result, topicOverride = '') {
    const topic = normalizePlaceTopic(topicOverride || query);
    const title = normalizePlaceTopic(result?.title || '');
    const description = normalizePlaceTopic(result?.description || '');
    const hay = `${title} ${description}`.trim();
    if (!topic || !hay) {
        return { title: result?.title || '', url: result?.url || '', sourceType: result?.sourceType || '', relevanceScore: 0, exactishMatch: false, evidenceLevel: 'none' };
    }
    const exactishMatch = title === topic || title.includes(topic) || topic.includes(title);
    const tokens = topic.split(/\s+/).filter(token => token.length > 2);
    const overlap = tokens.filter(token => hay.includes(token)).length;
    const overlapScore = tokens.length ? overlap / tokens.length : 0;
    const relevanceScore = exactishMatch ? Math.max(0.9, overlapScore) : overlapScore;
    const needsPlaceType = PLACE_TYPE_PATTERN.test(String(query || ''));
    const evidenceLevel = relevanceScore >= 0.9 || (relevanceScore >= 0.67 && !needsPlaceType)
        ? 'strong'
        : (relevanceScore >= 0.5 ? 'weak' : 'none');
    return {
        title: String(result?.title || '').trim(),
        url: String(result?.url || '').trim(),
        sourceType: String(result?.sourceType || '').trim(),
        relevanceScore,
        exactishMatch,
        evidenceLevel
    };
}

export function isRelevantPlaceResult(query, result, topicOverride = '') {
    const evidence = scorePlaceEvidence(query, result, topicOverride);
    if (evidence.exactishMatch) return true;
    const topic = normalizePlaceTopic(topicOverride || query);
    const tokenCount = topic.split(/\s+/).filter(token => token.length > 2).length;
    if (!tokenCount) return false;
    const requiresPlaceType = PLACE_TYPE_PATTERN.test(String(query || ''));
    if (requiresPlaceType && evidence.relevanceScore < Math.min(1, 2 / Math.max(tokenCount, 1))) return false;
    return evidence.relevanceScore >= 0.67;
}
