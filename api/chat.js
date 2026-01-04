// Vercel Serverless Function for Gemini AI
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { message, systemPrompt, userName } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Get API key from environment variable
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            return res.status(500).json({ error: 'API key not configured' });
        }
        
        // Call Gemini API - UPDATED MODEL NAME
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: systemPrompt + '\n\nUser message: ' + message
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024,
                    }
                })
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API error:', errorData);
            return res.status(response.status).json({ 
                error: 'AI service error',
                details: errorData 
            });
        }
        
        const data = await response.json();
        
        // Extract text from Gemini response
        let aiText = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            aiText = data.candidates[0].content.parts[0].text;
        }
        
        // Try to parse as JSON (for structured responses)
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            // If not JSON, treat as plain text response
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText,
                action: null
            };
        }
        
        return res.status(200).json(parsedResponse);
        
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
