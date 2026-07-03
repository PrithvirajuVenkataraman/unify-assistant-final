import chatGroqHandler from './chat-groq.js';
import currentFactsHandler from './current-facts.js';
import marketsHandler from './markets.js';
import searchHandler from './search.js';
import visionHandler from './vision.js';
import extractUrlHandler from './extract-url.js';
import diagnosticsHandler from './diagnostics.js';

const ROUTES = new Map([
    ['/api/chat-groq', chatGroqHandler],
    ['/api/current-facts', currentFactsHandler],
    ['/api/markets', marketsHandler],
    ['/api/search', searchHandler],
    ['/api/extract-url', extractUrlHandler],
    ['/api/vision', visionHandler],
    ['/api/diagnostics', diagnosticsHandler]
]);

const RETIRED_ROUTES = new Map([
    ['/api/rag', 'Document upload has been retired. Live search is handled by /api/search.'],
    ['/api/document-ingest', 'Document upload has been retired. Use Live Vision through /api/vision.']
]);

export default async function handler(req, res) {
    const path = resolveRequestPath(req);
    const routeHandler = ROUTES.get(path);

    try {
        if (routeHandler) return await routeHandler(req, res);
        if (RETIRED_ROUTES.has(path)) {
            return res.status(410).json({
                success: false,
                error: {
                    code: 'route_retired',
                    message: RETIRED_ROUTES.get(path)
                }
            });
        }
        return res.status(404).json({
            success: false,
            error: {
                code: 'route_not_found',
                message: 'API route not found.'
            }
        });
    } catch (error) {
        console.error('[api] unhandled route error', {
            path,
            reason: String(error?.message || 'unknown_error')
        });
        return res.status(500).json({
            success: false,
            error: {
                code: 'internal_error',
                message: 'Internal server error.'
            }
        });
    }
}

export function resolveRequestPath(req) {
    const candidates = [
        req?.url,
        req?.headers?.['x-original-uri'],
        req?.headers?.['x-rewrite-url'],
        req?.headers?.['x-forwarded-uri'],
        req?.headers?.['x-invoke-path']
    ]
        .map(value => String(value || '').trim())
        .filter(Boolean);

    for (const value of candidates) {
        try {
            const pathname = value.startsWith('http://') || value.startsWith('https://')
                ? new URL(value).pathname
                : value.split('?')[0];
            if (!pathname) continue;
            return `/${pathname}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        } catch (_) {}
    }
    return '';
}
