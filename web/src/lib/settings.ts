/** Per-device UI preferences in localStorage. Storage can be unavailable; failures fall back to defaults. */

const PREFIX = 'veg-map:';

export function loadSetting<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch (e) {
    console.warn(`setting "${name}" could not be read; using default`, e);
    return fallback;
  }
}

export function saveSetting(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch (e) {
    console.warn(`setting "${name}" could not be saved`, e);
  }
}
