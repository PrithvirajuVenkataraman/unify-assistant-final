import { applyApiSecurity } from './_lib/security.js';

function hasEnv(name) {
    return String(process.env[name] || '').trim().length > 0;
}

function isEnabled(name) {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

export function buildDiagnosticsStatus() {
    return {
        model: {
            groqConfigured: hasEnv('GROQ_API_KEY'),
            geminiConfigured: hasEnv('GEMINI_API_KEY') || hasEnv('GOOGLE_API_KEY')
        },
        streaming: {
            available: true
        },
        vision: {
            configured: hasEnv('GEMINI_API_KEY') || hasEnv('GOOGLE_API_KEY')
        },
        retrieval: {
            liveSearchEnabled: isEnabled('LIVE_RETRIEVAL_ENABLED'),
            exaConfigured: hasEnv('EXA_API_KEY') || hasEnv('EXA_KEY'),
            nvidiaConfigured: hasEnv('NVIDIA_API_KEY') || hasEnv('NVIDIA_NIM_API_KEY'),
            crawl4aiConfigured: hasEnv('CRAWL4AI_URL') || hasEnv('CRAWL4AI_ENDPOINT')
        }
    };
}

export default async function handler(req, res) {
    const security = applyApiSecurity(req, res, {
        methods: ['GET', 'POST', 'OPTIONS'],
        rateLimit: { key: 'diagnostics', max: 40 }
    });
    if (security.handled) return;

    return res.status(200).json({
        ok: true,
        diagnostics: buildDiagnosticsStatus()
    });
}
