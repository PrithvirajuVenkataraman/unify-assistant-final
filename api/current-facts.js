export const config = { maxDuration: 60 };

import { applyApiSecurity } from './security.js';

export const LIVE_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    resolved: false,
    error: Object.freeze({
        code: 'feature_disabled', 
        message: 'Live search is temporarily disabled.'
    }),
    answer: '',
    sources: []
});

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'current-facts',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    return res.status(503).json({ ...LIVE_DISABLED_RESPONSE });
}

export const __test = {
    liveDisabledResponse: LIVE_DISABLED_RESPONSE
};
