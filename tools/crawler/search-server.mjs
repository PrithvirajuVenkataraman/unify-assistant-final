import http from 'node:http';
import { readLocalIndex, searchLocalIndex } from './crawler.js';

const port = Number.parseInt(process.env.CRAWLER_SEARCH_PORT || '7700', 10);
const host = process.env.CRAWLER_SEARCH_HOST || '127.0.0.1';
const token = String(process.env.CRAWLER_SEARCH_KEY || '').trim();

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/health') {
            return sendJson(res, 200, { status: 'available' });
        }
        if (req.method !== 'POST' || !req.url?.startsWith('/search')) {
            return sendJson(res, 404, { success: false, error: { code: 'not_found' } });
        }
        if (token && req.headers.authorization !== `Bearer ${token}`) {
            return sendJson(res, 401, { success: false, error: { code: 'unauthorized' } });
        }
        const body = await readJsonBody(req, 32 * 1024);
        const query = String(body.query || body.q || '').trim();
        const limit = Number.parseInt(body.limit || '8', 10);
        if (!query) {
            return sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'Query is required.' } });
        }
        const documents = await readLocalIndex();
        const results = searchLocalIndex(documents, query, { limit });
        return sendJson(res, 200, {
            success: true,
            provider: 'crawler_index',
            query,
            results,
            indexResultCount: results.length,
            sourceCount: results.length
        });
    } catch (error) {
        return sendJson(res, 500, {
            success: false,
            error: { code: 'crawler_search_failed', message: String(error?.message || error) }
        });
    }
});

server.listen(port, host, () => {
    console.log(`crawler-search listening on http://${host}:${port}`);
});

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error('Request body too large.');
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
}
