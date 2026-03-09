export default async function handler(req, res) {
    // Enable CORS
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
        const { message, userName, systemPrompt: clientSystemPrompt, ragContext, context } = req.body || {};

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const systemPrompt = clientSystemPrompt || buildServerSystemPrompt(userName);
        const contextBlock = Array.isArray(context)
            ? context
                .slice(-20)
                .map(m => `${m?.role === 'user' ? 'User' : 'Assistant'}: ${String(m?.text || '')}`)
                .join('\n')
            : '';
        const ragBlock = typeof ragContext === 'string' ? ragContext.trim() : '';
        const finalPrompt = [
            systemPrompt,
            ragBlock ? `Retrieved context (RAG):\n${ragBlock}` : '',
            contextBlock ? `Recent turns:\n${contextBlock}` : '',
            `User message: ${message}`
        ].filter(Boolean).join('\n\n');

        // Prefer Groq for this endpoint; keep Gemini fallback for compatibility.
        const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
        if (groqApiKey) {
            const groqConfiguredModel = String(process.env.GROQ_MODEL || '').trim();
            const groqCandidates = [
                groqConfiguredModel,
                'llama-3.3-70b-versatile',
                'llama-3.1-8b-instant'
            ].filter(Boolean);

            let groqText = '';
            let modelUsed = null;
            let lastErrorDetail = '';
            const triedModels = [];

            for (const model of groqCandidates) {
                triedModels.push(model);
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${groqApiKey}`
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.7,
                        max_tokens: 2500,
                        messages: [
                            { role: 'user', content: finalPrompt }
                        ]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    groqText = String(data?.choices?.[0]?.message?.content || '').trim();
                    modelUsed = model;
                    break;
                }

                const bodyText = await response.text().catch(() => '');
                lastErrorDetail = `provider=groq, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
            }

            if (groqText) {
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(groqText);
                } catch (e) {
                    parsedResponse = {
                        intent: 'casual_chat',
                        response: groqText,
                        action: null
                    };
                }

                return res.status(200).json({
                    ...parsedResponse,
                    modelUsed,
                    provider: 'groq'
                });
            }

            return res.status(502).json({
                error: 'AI service temporarily unavailable',
                details: lastErrorDetail || 'Groq did not return a successful response.',
                triedModels,
                provider: 'groq'
            });
        }

        // Fallback path: Gemini if GROQ key is not configured.
        const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!geminiApiKey) {
            return res.status(500).json({
                error: 'API key not configured',
                details: 'Set GROQ_API_KEY (preferred) or GEMINI_API_KEY/GOOGLE_API_KEY in your server environment.'
            });
        }

        const geminiConfiguredModel = String(process.env.GEMINI_MODEL || '').trim();
        const geminiCandidates = [
            geminiConfiguredModel,
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash'
        ].filter(Boolean);

        let geminiData = null;
        let modelUsed = null;
        let lastErrorDetail = '';
        const triedModels = [];

        for (const model of geminiCandidates) {
            triedModels.push(model);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: finalPrompt }]
                        }],
                        generationConfig: {
                            temperature: 0.7,
                            topK: 40,
                            topP: 0.95,
                            maxOutputTokens: 2500,
                        }
                    })
                }
            );

            if (response.ok) {
                geminiData = await response.json();
                modelUsed = model;
                break;
            }

            const bodyText = await response.text().catch(() => '');
            lastErrorDetail = `provider=gemini, model=${model}, status=${response.status}, body=${bodyText.slice(0, 300)}`;
        }

        if (!geminiData) {
            return res.status(502).json({
                error: 'AI service temporarily unavailable',
                details: lastErrorDetail || 'No Gemini model responded successfully.',
                triedModels,
                provider: 'gemini'
            });
        }

        let aiText = '';
        if (geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiText = geminiData.candidates[0].content.parts[0].text;
        }

        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiText);
        } catch (e) {
            parsedResponse = {
                intent: 'casual_chat',
                response: aiText,
                action: null
            };
        }

        return res.status(200).json({
            ...parsedResponse,
            modelUsed,
            provider: 'gemini'
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Internal server error',
            details: String(error?.message || error)
        });
    }
}

function buildServerSystemPrompt(userName) {
    return `You are Unify, a helpful voice assistant.${userName ? ` The user's name is ${userName}.` : ''}

Your capabilities:
- Weather
- Reminders
- Memory (remembering where things are)

Respond conversationally and naturally.`;
}
