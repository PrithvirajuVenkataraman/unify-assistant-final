import { applyApiSecurity } from './security.js';
import { ragEnvSummary, upsertDocumentToPinecone } from './rag-core.js';

export const config = {
    maxDuration: 60,
    api: { bodyParser: { sizeLimit: '2mb' } }
};

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'rag-upsert',
        maxBodyBytes: 2 * 1024 * 1024,
        rateLimit: { max: 12, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const { text, documentId, namespace, metadata, chunkSize, chunkOverlap, embedBatchSize } = req.body || {};
        if (!String(text || '').trim()) {
            return res.status(400).json({ success: false, error: 'text is required' });
        }

        const result = await upsertDocumentToPinecone({
            text,
            documentId,
            namespace,
            metadata,
            chunkSize,
            chunkOverlap,
            embedBatchSize
        });

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'rag_upsert_failed',
            details: String(error?.message || 'unknown').slice(0, 220),
            env: ragEnvSummary()
        });
    }
}

