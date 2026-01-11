// Vercel Edge Function - v2.0 - NEW MODELS
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
    console.log('🚀 Edge function v2.0 called - NEW MODELS');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        });
    }
    
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { message, systemPrompt } = await req.json();
        
        if (!message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const API_KEY = process.env.GEMINI_API_KEY;
        
        if (!API_KEY) {
            console.error('❌ GEMINI_API_KEY not found!');
            return new Response(JSON.stringify({ 
                response: 'API key not configured. Check Vercel environment variables.',
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        console.log('✅ API Key found');
        
        // Use ACTUAL Gemini 3 and 2.5 models
        const MODELS_TO_TRY = [
            { name: 'gemini-3.0-flash', version: 'v1' },
            { name: 'gemini-3.0-flash-preview', version: 'v1' },
            { name: 'gemini-2.5-flash', version: 'v1' },
            { name: 'gemini-2.5-pro', version: 'v1' },
            { name: 'gemini-2.0-flash-exp', version: 'v1alpha' },
            { name: 'gemini-exp-1206', version: 'v1alpha' }
        ];
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: systemPrompt + '\n\nUser message: ' + message
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4850,
                candidateCount: 1
            }
        };
        
        let response;
        let lastError;
        let workingModel = null;
        let workingVersion = null;
        
        // Try each model with its specific API version
        for (const modelConfig of MODELS_TO_TRY) {
            const MODEL = modelConfig.name;
            const API_VERSION = modelConfig.version;
            
            console.log(`🧪 Trying: ${API_VERSION}/models/${MODEL}`);
            
            try {
                response = await fetch(
                    `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL}:generateContent?key=${API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    }
                );
                
                if (response.ok) {
                    workingModel = MODEL;
                    workingVersion = API_VERSION;
                    console.log(`✅ SUCCESS with ${API_VERSION}/models/${MODEL}`);
                    break;
                } else {
                    const errorData = await response.json();
                    lastError = errorData;
                    console.log(`❌ ${MODEL} failed:`, errorData.error?.message?.substring(0, 100));
                }
            } catch (err) {
                console.log(`❌ ${MODEL} error:`, err.message);
                lastError = err;
            }
        }
        
        if (!workingModel) {
            console.error('❌ ALL MODELS FAILED');
            return new Response(JSON.stringify({ 
                response: `All models failed. Last error: ${lastError?.error?.message || 'Unknown'}`,
                intent: 'error'
            }), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const data = await response.json();
        
        let aiText = '';
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiText = data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Invalid API response structure');
        }
        
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText
            };
        }
        
        return new Response(JSON.stringify(parsedResponse), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        
        return new Response(JSON.stringify({ 
            response: "Error: " + error.message,
            intent: 'error'
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
