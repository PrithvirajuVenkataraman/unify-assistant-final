const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_MAX = 60;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function getRateStore() {
    if (!globalThis.__unifyRateLimitStore) {
        globalThis.__unifyRateLimitStore = new Map();
    }
    return globalThis.__unifyRateLimitStore;
}

function parseAllowedOrigins() {
    const raw = String(process.env.CORS_ALLOWED_ORIGINS || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function resolveClientIp(req) {
    const xfwd = String(req?.headers?.['x-forwarded-for'] || '').trim();
    if (xfwd) {
        const first = xfwd.split(',')[0].trim();
        if (first) return first;
    }
    return String(
        req?.headers?.['x-real-ip'] ||
        req?.socket?.remoteAddress ||
        req?.connection?.remoteAddress ||
        'unknown'
    ).trim();
}

function parseBodyBytes(req) {
    try {
        const body = req?.body ?? {};
        return Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch (_) {
        return 0;
    }
}

function setDefaultSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function applyCors(req, res) {
    const allowedOrigins = parseAllowedOrigins();
    const requestOrigin = String(req?.headers?.origin || '').trim();

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (!allowedOrigins.length) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return { ok: true };
    }

    const allowed = requestOrigin && allowedOrigins.includes(requestOrigin);
    res.setHeader('Vary', 'Origin');
    if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        return { ok: true };
    }

    if (!requestOrigin) {
        return { ok: true };
    }

    return { ok: false };
}

function applyRateLimit(req, res, options = {}) {
    const routeKey = String(options.routeKey || 'api');
    const envWindow = Number(process.env.RATE_LIMIT_WINDOW_MS || '');
    const envMax = Number(process.env.RATE_LIMIT_MAX || '');
    const windowMs = Number(options.windowMs || envWindow || DEFAULT_RATE_WINDOW_MS);
    const max = Number(options.max || envMax || DEFAULT_RATE_MAX);
    const ip = resolveClientIp(req);
    const now = Date.now();
    const resetAt = now + windowMs;
    const store = getRateStore();
    const key = `${routeKey}:${ip}`;
    const existing = store.get(key);
    const current = (!existing || existing.resetAt <= now)
        ? { count: 0, resetAt }
        : existing;

    current.count += 1;
    store.set(key, current);

    const remaining = Math.max(0, max - current.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(current.resetAt / 1000)));

    if (current.count > max) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
            success: false,
            error: 'Too many requests. Please retry shortly.'
        });
        return false;
    }

    return true;
}

export function applyApiSecurity(req, res, options = {}) {
    setDefaultSecurityHeaders(res);

    const cors = applyCors(req, res);
    if (!cors.ok) {
        res.status(403).json({ success: false, error: 'Origin not allowed' });
        return { handled: true };
    }

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return { handled: true };
    }

    const allowedMethods = Array.isArray(options.methods) && options.methods.length
        ? options.methods
        : ['POST'];
    if (!allowedMethods.includes(req.method)) {
        res.status(405).json({ success: false, error: 'Method not allowed' });
        return { handled: true };
    }

    const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
    if (allowedMethods.includes('POST') && !contentType.includes('application/json')) {
        res.status(415).json({ success: false, error: 'Content-Type must be application/json' });
        return { handled: true };
    }

    const maxBodyBytes = Number(options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES);
    const actualBytes = parseBodyBytes(req);
    if (actualBytes > maxBodyBytes) {
        res.status(413).json({ success: false, error: 'Request body too large' });
        return { handled: true };
    }

    const rateLimitOptions = options.rateLimit || {};
    const okRate = applyRateLimit(req, res, {
        routeKey: options.routeKey || 'api',
        windowMs: rateLimitOptions.windowMs,
        max: rateLimitOptions.max
    });
    if (!okRate) {
        return { handled: true };
    }

    return { handled: false };
}
