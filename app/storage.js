export function createSafeStorage(storage = globalThis.localStorage) {
    return {
        getJson(key, fallback = null) {
            try {
                const value = storage?.getItem?.(key);
                return value == null ? fallback : JSON.parse(value);
            } catch {
                return fallback;
            }
        },
        setJson(key, value) {
            try {
                storage?.setItem?.(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        remove(key) {
            try {
                storage?.removeItem?.(key);
                return true;
            } catch {
                return false;
            }
        }
    };
}
