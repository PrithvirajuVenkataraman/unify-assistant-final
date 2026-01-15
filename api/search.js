// Brave Search API for hotel verification
// Get free API key: https://brave.com/search/api/

export default async function handler(req, res) {
    console.log('🔍 Brave Search API called');
    
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        
        const API_KEY = process.env.BRAVE_SEARCH_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ BRAVE_SEARCH_API_KEY not found!');
            return res.status(200).json({ 
                results: [],
                error: 'Search API key not configured'
            });
        }
        
        console.log(`🔍 Searching: ${query}`);
        
        // Call Brave Search API
        const response = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
            {
                method: 'GET',
                headers: { 
                    'Accept': 'application/json',
                    'X-Subscription-Token': API_KEY
                }
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Brave Search Error:', errorData);
            return res.status(200).json({ 
                results: [],
                error: 'Search failed'
            });
        }
        
        const data = await response.json();
        console.log('✅ Search results received');
        
        // Extract relevant info
        const results = data.web?.results?.slice(0, 5).map(r => ({
            title: r.title,
            description: r.description,
            url: r.url
        })) || [];
        
        return res.status(200).json({
            results: results,
            query: query
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return res.status(200).json({ 
            results: [],
            error: error.message
        });
    }
}
