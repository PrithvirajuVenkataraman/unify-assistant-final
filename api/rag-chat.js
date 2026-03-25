import { applyApiSecurity } from './security.js';
import { queryPineconeRag, ragEnvSummary } from './rag-core.js';

export const config = { maxDuration: 60 };

function getBaseUrl(req) {
    const host = String(req?.headers?.host || '').trim();
    if (!host) return '';
    const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').trim();
    return `${proto}://${host}`;
}

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'rag-chat',
        maxBodyBytes: 500 * 1024,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    try {
        const {
            message,
            namespace,
            topK,
            filter,
            userName,
            context,
            systemPrompt,
            ragOnly = false
        } = req.body || {};

        const cleanMessage = String(message || '').trim();
        if (!cleanMessage) {
            return res.status(400).json({ success: false, error: 'message is required' });
        }

        const retrieval = await queryPineconeRag({
            query: cleanMessage,
            namespace,
            topK,
            filter
        });

        if (ragOnly) {
            return res.status(200).json({
                success: true,
                intent: 'rag_retrieval',
                response: retrieval.ragContext || 'No relevant context found in vector store.',
                rag: retrieval
            });
        }

        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
            return res.status(500).json({
                success: false,
                error: 'rag_chat_failed',
                details: 'Could not resolve internal base URL for /api/chat-groq.'
            });
        }

        const chatResponse = await fetch(`${baseUrl}/api/chat-groq`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: cleanMessage,
                userName,
                systemPrompt,
                context,
                ragContext: retrieval.ragContext
            })
        });

        const raw = await chatResponse.text();
        const parsed = raw ? JSON.parse(raw) : {};

        return res.status(200).json({
            ...parsed,
            rag: {
                namespace: retrieval.namespace,
                topK: retrieval.topK,
                sourceCount: retrieval.matches.length,
                matches: retrieval.matches.map(m => ({
                    id: m.id,
                    score: m.score,
                    metadata: m.metadata
                }))
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'rag_chat_failed',
            details: String(error?.message || 'unknown').slice(0, 220),
            env: ragEnvSummary()
        });
    }
}

