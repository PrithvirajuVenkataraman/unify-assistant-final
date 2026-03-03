export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { prompt = '', task = 'general_vision', mimeType = 'image/jpeg', imageBase64 = '' } = req.body || {};
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            return res.status(400).json({ success: false, error: 'imageBase64 is required' });
        }
        if (!/^image\//i.test(String(mimeType || ''))) {
            return res.status(400).json({ success: false, error: 'Unsupported mimeType' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'API key not configured' });
        }

        const systemPrompt = buildVisionPrompt(prompt, task);
        const geminiResponse = await callGeminiVision({
            apiKey,
            systemPrompt,
            mimeType,
            imageBase64
        });

        const rawText = extractGeminiText(geminiResponse);
        if (!rawText) {
            return res.status(502).json({ success: false, error: 'Vision model returned an empty response' });
        }

        const parsed = safeParseJson(rawText);
        if (!parsed) {
            return res.status(200).json({
                success: true,
                response: rawText,
                task,
                raw: true
            });
        }

        return res.status(200).json({
            success: true,
            task,
            response: formatVisionResponse(parsed, task),
            details: parsed
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Vision processing failed'
        });
    }
}

async function callGeminiVision({ apiKey, systemPrompt, mimeType, imageBase64 }) {
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    let lastError = null;

    for (const model of models) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    { text: systemPrompt },
                                    {
                                        inlineData: {
                                            mimeType,
                                            data: imageBase64
                                        }
                                    }
                                ]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.2,
                            topP: 0.9,
                            maxOutputTokens: 1500
                        }
                    })
                }
            );

            if (!response.ok) {
                lastError = new Error(`Model ${model} failed with status ${response.status}`);
                continue;
            }

            return await response.json();
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('No vision model available');
}

function buildVisionPrompt(userPrompt, task) {
    const taskRule = getTaskRule(task);
    return [
        'You are a vision analysis engine.',
        'Analyze the provided image and return strictly valid JSON only.',
        'No markdown, no code fences, no extra text.',
        'Detect visible objects including people, animals, food, devices, vehicles, and common items.',
        'If text appears in image, include extracted snippets in textDetected.',
        `Requested task: ${task}.`,
        `Task-specific requirement: ${taskRule}`,
        `User prompt: ${String(userPrompt || '').trim() || 'Analyze this image.'}`,
        'JSON schema:',
        '{',
        '  "summary": "short useful summary",',
        '  "objects": [',
        '    { "label": "person", "count": 2, "confidence": 0.88 }',
        '  ],',
        '  "people": [',
        '    { "description": "adult standing near table", "count": 1 }',
        '  ],',
        '  "animals": [',
        '    { "label": "dog", "count": 1, "confidence": 0.85 }',
        '  ],',
        '  "textDetected": ["sample text"],',
        '  "shoppingItems": ["milk", "eggs"],',
        '  "bill": {',
        '    "lineItems": ["Milk - $3.99"],',
        '    "totals": ["Total: $23.11"]',
        '  }',
        '}',
        'Rules:',
        '- Use empty arrays when a section does not apply.',
        '- Confidence values must be between 0 and 1.',
        '- Keep summary under 60 words.',
        '- Do not fabricate unreadable text; only include likely readable snippets.'
    ].join('\n');
}

function getTaskRule(task) {
    switch (task) {
        case 'bill_summary':
            return 'Focus on bill line items and totals. Include tax and grand total when visible.';
        case 'shopping_extract':
            return 'Focus on purchasable item names and quantities. Exclude payment metadata.';
        case 'fridge_items':
            return 'Focus on food and drink items visible in fridge shelves and door.';
        case 'people_count':
            return 'Focus on counting people/humans accurately and include count in summary.';
        case 'animal_detect':
            return 'Focus on animals and species labels. Include counts and confidence.';
        case 'object_detect':
            return 'Focus on broad object detection with labels and counts.';
        case 'text_extract':
            return 'Focus on OCR text extraction from signs, labels, and printed text.';
        default:
            return 'Provide a balanced scene analysis including objects, people, animals, and visible text.';
    }
}

function extractGeminiText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim();
}

function safeParseJson(text) {
    const cleaned = String(text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

function formatVisionResponse(data, task) {
    const summary = String(data?.summary || 'Image analyzed.');
    const objects = normalizeDetected(data?.objects);
    const people = Array.isArray(data?.people) ? data.people : [];
    const animals = normalizeDetected(data?.animals);
    const textDetected = Array.isArray(data?.textDetected) ? data.textDetected : [];
    const shoppingItems = Array.isArray(data?.shoppingItems) ? data.shoppingItems : [];
    const bill = data?.bill && typeof data.bill === 'object' ? data.bill : { lineItems: [], totals: [] };
    const billItems = Array.isArray(bill.lineItems) ? bill.lineItems : [];
    const billTotals = Array.isArray(bill.totals) ? bill.totals : [];

    const lines = [`Vision summary: ${summary}`];

    if (task === 'people_count') {
        const peopleCountFromList = people.reduce((sum, p) => sum + Number(p?.count || 1), 0);
        const peopleCountFromObjects = objects
            .filter(o => /person|people|human/i.test(String(o?.label || '')))
            .reduce((sum, o) => sum + Number(o?.count || 0), 0);
        const count = Math.max(peopleCountFromList, peopleCountFromObjects);
        lines.push(`People count: ${count}`);
    }

    if (objects.length) {
        const top = objects
            .slice(0, 12)
            .map(o => `${String(o?.label || 'object')} x${Number(o?.count || 1)}${typeof o?.confidence === 'number' ? ` (${Math.round(o.confidence * 100)}%)` : ''}`)
            .join(', ');
        lines.push(`Objects: ${top}`);
    }

    if (people.length) {
        lines.push(`People: ${people.slice(0, 6).map(p => String(p?.description || 'person')).join(', ')}`);
    }

    if (animals.length) {
        lines.push(`Animals: ${animals.slice(0, 8).map(a => `${String(a?.label || 'animal')} x${Number(a?.count || 1)}${typeof a?.confidence === 'number' ? ` (${Math.round(a.confidence * 100)}%)` : ''}`).join(', ')}`);
    }

    if (textDetected.length) {
        lines.push(`Detected text: ${textDetected.slice(0, 8).join(' | ')}`);
    }

    if (task === 'text_extract' && !textDetected.length) {
        lines.push('No clear text detected.');
    }

    if (task === 'shopping_extract' && shoppingItems.length) {
        lines.push(`Shopping items:\n- ${shoppingItems.slice(0, 20).join('\n- ')}`);
    }

    if (task === 'fridge_items' && shoppingItems.length) {
        lines.push(`Fridge items:\n- ${shoppingItems.slice(0, 20).join('\n- ')}`);
    }

    if (task === 'bill_summary') {
        if (billItems.length) {
            lines.push(`Bill items:\n- ${billItems.slice(0, 12).join('\n- ')}`);
        }
        if (billTotals.length) {
            lines.push(`Bill totals:\n- ${billTotals.slice(0, 8).join('\n- ')}`);
        }
    }

    return lines.join('\n\n');
}

function normalizeDetected(list) {
    if (!Array.isArray(list)) return [];
    return list
        .map(item => ({
            label: String(item?.label || '').trim() || 'object',
            count: Math.max(1, Number(item?.count || 1)),
            confidence: typeof item?.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : null
        }))
        .sort((a, b) => {
            const ca = a.confidence ?? -1;
            const cb = b.confidence ?? -1;
            if (cb !== ca) return cb - ca;
            return b.count - a.count;
        });
}
