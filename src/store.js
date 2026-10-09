// Small saved settings on this device (favorites, checks, "seen the welcome").
// Storage can be blocked (private windows), so every read and write is allowed to fail.
const PREFIX = 'lit.';

export function load(name, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + name);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Not saved, but the app keeps working for this visit.
  }
}
