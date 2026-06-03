export const config = { maxDuration: 60 };

import { applyApiSecurity } from './security.js';

export const LIVE_SEARCH_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    error: 'Live search is temporarily disabled.',
    results: []
});

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    return res.status(503).json({ ...LIVE_SEARCH_DISABLED_RESPONSE });
}

export function hasSerperKey() {
    return false;
}

export async function searchSerper() {
    return [];
}

export async function runVerifiedWebSearch() {
    return { results: [], distinctDomains: [], trustedCount: 0 };
}

export async function searchGoogleNewsRss() {
    return [];
}

export function extractSearchTopic(text) {
    return String(text || '')
        .replace(/^\s*(latest|current|today'?s|recent|breaking)\s+/i, '')
        .replace(/\b(news|headlines|updates?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

export function isTrustedLiveSource() {
    return false;
}

export const __test = {
    liveSearchDisabledResponse: LIVE_SEARCH_DISABLED_RESPONSE
};
