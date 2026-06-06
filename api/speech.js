export const config = { maxDuration: 60 };
import { applyApiSecurity } from './security.js';

const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'speech',
        maxBodyBytes: 8 * 1024 * 1024,
        rateLimit: { max: 45, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const mode = String(req.body?.mode || '').trim().toLowerCase();
    if (mode === 'transcribe') return await handleTranscribe(req, res);
    return res.status(400).json({ success: false, error: 'mode must be transcribe' });
}

async function handleTranscribe(req, res) {
    const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
    if (!apiKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEY is not configured' });

    const audioBase64 = String(req.body?.audioBase64 || '').trim();
    if (!audioBase64) return res.status(400).json({ success: false, error: 'audioBase64 is required' });
    const mimeType = String(req.body?.mimeType || 'audio/webm').trim();
    const model = String(process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL).trim();

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const form = new FormData();
    form.append('model', model);
    form.append('response_format', 'json');
    form.append('file', new Blob([audioBuffer], { type: mimeType }), extensionForMime(mimeType));

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`
        },
        body: form
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return res.status(response.status).json({
            success: false,
            error: `Groq transcription failed: ${String(detail || response.statusText).slice(0, 300)}`
        });
    }

    const data = await response.json();
    return res.status(200).json({
        success: true,
        model,
        text: String(data?.text || '').trim()
    });
}

function extensionForMime(mimeType) {
    const t = String(mimeType || '').toLowerCase();
    if (t.includes('mp4')) return 'speech.m4a';
    if (t.includes('mpeg') || t.includes('mp3')) return 'speech.mp3';
    if (t.includes('wav')) return 'speech.wav';
    if (t.includes('ogg')) return 'speech.ogg';
    return 'speech.webm';
}
