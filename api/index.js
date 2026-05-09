  import chatGroqHandler from './chat-groq.js';
  import documentIngestHandler from './document-ingest.js';
  import marketsHandler from './markets.js';
  import searchHandler from './search.js';
  import visionHandler from './vision.js';

  // Unified API Handler to bypass Vercel's Serverless Function limits
  export default async function handler(req, res) {
    const path = resolveRequestPath(req);
    try {
      if (path.includes('/chat-groq')) {
        return await chatGroqHandler(req, res);
      } else if (path.includes('/rag')) {
        return res.status(410).json({
          success: false,
          error: 'The legacy /api/rag endpoint has been retired.',
          hint: 'Use /api/document-ingest for uploads and /api/chat-groq for Q&A.'
        });
      } else if (path.includes('/document-ingest')) {
        return await documentIngestHandler(req, res);
      } else if (path.includes('/markets')) {
        return await marketsHandler(req, res);
      } else if (path.includes('/search')) {
        return await searchHandler(req, res);
      } else if (path.includes('/vision')) {
        return await visionHandler(req, res);
      }
      
      // Add any additional handlers here...
      return res.status(404).json({ error: 'Unified API Route Not Found' });
    } catch (error) {
      console.error("API Error:", error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  function resolveRequestPath(req) {
    const candidates = [
      req?.url,
      req?.headers?.['x-original-uri'],
      req?.headers?.['x-rewrite-url'],
      req?.headers?.['x-forwarded-uri'],
      req?.headers?.['x-invoke-path']
    ]
      .map(v => String(v || '').trim())
      .filter(Boolean);

    for (const value of candidates) {
      try {
        if (value.startsWith('http://') || value.startsWith('https://')) {
          return new URL(value).pathname;
        }
        return value.split('?')[0] || value;
      } catch (_) {}
    }

    return '';
  }
