// localStorage access. Every call is guarded: storage can be missing or throw (private mode, file:// policies).

let available = probe();

function probe(): boolean {
    try {
        const k = "tfview:probe";
        localStorage.setItem(k, "1");
        localStorage.removeItem(k);
        return true;
    } catch {
        return false;
    }
}

export function storageAvailable(): boolean {
    return available;
}

export function readJson(key: string): unknown {
    if (!available) return undefined;
    try {
        const text = localStorage.getItem(key);
        return text === null ? undefined : JSON.parse(text);
    } catch {
        // Unreadable or corrupt: treat as absent.
        return undefined;
    }
}

/** Returns false once storage turns out to be unusable. */
export function writeJson(key: string, value: unknown): boolean {
    if (!available) return false;
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        available = false;
        return false;
    }
}
