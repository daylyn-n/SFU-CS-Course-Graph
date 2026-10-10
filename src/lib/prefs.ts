// Small per-device UI preferences (open panels, dismissed hints). Storage can
// be missing or throw (private windows, blocked site data), so every access
// falls back quietly to the default.

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
