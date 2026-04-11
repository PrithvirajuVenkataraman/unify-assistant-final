import chatGroqHandler from './chat-groq.js';
import documentIngestHandler from './document-ingest.js';
import marketsHandler from './markets.js';
import ragHandler from './rag.js';
import searchHandler from './search.js';
import visionHandler from './vision.js';

// Unified API Handler to bypass Vercel's Serverless Function limits
export default async function handler(req, res) {
  const path = req.url || '';
  
  try {
    if (path.includes('/chat-groq')) {
      return await chatGroqHandler(req, res);
    } else if (path.includes('/document-ingest')) {
      return await documentIngestHandler(req, res);
    } else if (path.includes('/markets')) {
      return await marketsHandler(req, res);
    } else if (path.includes('/rag')) {
      return await ragHandler(req, res);
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
