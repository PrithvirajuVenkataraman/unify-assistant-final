// JARVIS with Groq AI (COMPLETELY FREE - No quota limits like Gemini!)
// Get free API key: https://console.groq.com/keys

export default async function handler(req, res) {
    console.log('🚀 JARVIS API called (Groq)');
    
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
        const { message, systemPrompt } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const API_KEY = process.env.GROQ_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GROQ_API_KEY not found!');
            return res.status(200).json({ 
                response: 'Groq API key not configured. Get free key at: https://console.groq.com/keys'
            });
        }
        
        console.log('✅ Groq API Key found');
        
        // Use Llama 3.3 70B (free, fast, smart!)
        const MODEL = 'llama-3.3-70b-versatile';
        
        console.log(`🚀 Calling Groq with ${MODEL}`);
        
        const requestBody = {
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt || 'You are JARVIS, a helpful AI assistant.'
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            temperature: 0.7,
            max_tokens: 4096,
            top_p: 1,
            stream: false
        };
        
        const response = await fetch(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify(requestBody)
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Groq API Error:', errorData.error?.message);
            return res.status(200).json({ 
                response: `Groq API Error: ${errorData.error?.message || 'Unknown error'}`
            });
        }
        
        const data = await response.json();
        console.log('✅ SUCCESS - Got response from Groq');
        
        const aiText = data.choices?.[0]?.message?.content;
        
        if (!aiText) {
            console.error('❌ No text in response');
            return res.status(200).json({ 
                response: 'No response from AI. Please try again.'
            });
        }
        
        return res.status(200).json({
            response: aiText.trim(),
            model: MODEL
        });
        
    } catch (error) {
        console.error('❌ Critical Error:', error.message);
        return res.status(200).json({ 
            response: `Error: ${error.message}`
        });
    }
}
