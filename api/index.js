import askHandler from './ask.js';
import chatGroqHandler from './chat-groq.js';
import commoditiesHandler from './commodities.js';
import documentIngestHandler from './document-ingest.js';
import exchangeHandler from './exchange.js';
import marketsHandler from './markets.js';
import placesHandler from './places.js';
import ragHandler from './rag.js';
import searchHandler from './search.js';

// Unified API Handler to bypass Vercel's Serverless Function limits
export default async function handler(req, res) {
  const path = req.url || '';
  
  try {
    if (path.includes('/ask')) {
      return await askHandler(req, res);
    } else if (path.includes('/chat-groq')) {
      return await chatGroqHandler(req, res);
    } else if (path.includes('/commodities')) {
      return await commoditiesHandler(req, res);
    } else if (path.includes('/document-ingest')) {
      return await documentIngestHandler(req, res);
    } else if (path.includes('/exchange')) {
      return await exchangeHandler(req, res);
    } else if (path.includes('/markets')) {
      return await marketsHandler(req, res);
    } else if (path.includes('/places')) {
      return await placesHandler(req, res);
    } else if (path.includes('/rag')) {
      return await ragHandler(req, res);
    } else if (path.includes('/search')) {
      return await searchHandler(req, res);
    }
    
    // Add any additional handlers here...
    return res.status(404).json({ error: 'Unified API Route Not Found' });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
