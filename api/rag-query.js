import { applyApiSecurity } from './security.js';
import { queryPineconeRag, ragEnvSummary } from './rag-core.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'rag-query',
        maxBodyBytes: 300 * 1024,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const { query, topK, namespace, filter } = req.body || {};
        if (!String(query || '').trim()) {
            return res.status(400).json({ success: false, error: 'query is required' });
        }

        const result = await queryPineconeRag({ query, topK, namespace, filter });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'rag_query_failed',
            details: String(error?.message || 'unknown').slice(0, 220),
            env: ragEnvSummary()
        });
    }
}

