export class ApiError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = Number(options.status) || 0;
        this.code = String(options.code || 'request_failed');
        this.retryable = Boolean(options.retryable);
        this.details = options.details ?? null;
    }
}

export async function postJson(path, payload, options = {}) {
    const timeoutMs = clamp(options.timeoutMs, 18000, 1000, 60000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.signal;
    const abortExternal = () => controller.abort();
    externalSignal?.addEventListener?.('abort', abortExternal, { once: true });

    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(payload ?? {})
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false) {
            const error = data?.error;
            throw new ApiError(
                String(error?.message || error || `Request failed with status ${response.status}`),
                {
                    status: response.status,
                    code: error?.code || data?.code || 'request_failed',
                    retryable: response.status === 429 || response.status >= 500,
                    details: error?.details || null
                }
            );
        }
        return data;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new ApiError('The request timed out or was cancelled.', {
                code: 'request_aborted',
                retryable: true
            });
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError('The service is unavailable. Please try again.', {
            code: 'network_error',
            retryable: true,
            details: String(error?.message || error)
        });
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.('abort', abortExternal);
    }
}

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
