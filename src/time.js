// Clock helpers: opening hours, sunrise and sunset, and formatting.
import { getTimes } from 'suncalc';
import { CONFIG } from './config.js';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Each day holds a list of [open, close] periods. Open if inside one of today's periods,
// or inside one of yesterday's that ran past midnight.
export function isOpen(b, date) {
  const now = date.getHours() * 60 + date.getMinutes();
  const today = (b.hours[DAYS[date.getDay()]] ?? []).map((p) => p.map(toMin));
  const yesterday = (b.hours[DAYS[(date.getDay() + 6) % 7]] ?? []).map((p) => p.map(toMin));
  return (
    today.some(([o, c]) => (c > o ? now >= o && now < c : now >= o)) ||
    yesterday.some(([o, c]) => c <= o && now < c)
  );
}

// The night a time belongs to starts at 6 pm; times before 5 am belong to the previous evening.
export function eveningOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), CONFIG.clock.startHour);
  if (date.getHours() < 5) d.setDate(d.getDate() - 1);
  return d;
}

export function isLateBusTime(date) {
  const m = date.getHours() * 60 + date.getMinutes();
  return m >= CONFIG.lateBus.from || m < CONFIG.lateBus.until;
}

export function sunInfo(date) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const t = getTimes(noon, CONFIG.ithaca.lat, CONFIG.ithaca.lng);
  return { sunrise: t.sunrise, sunset: t.sunset, night: date < t.sunrise || date >= t.sunset };
}

export const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();

export const toInputValue = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// "Tonight", "Today", "Tomorrow night", or a weekday, for the time button.
export function dayWord(date, now = new Date()) {
  const evening = eveningOf(date);
  const tonight = eveningOf(now);
  const days = Math.round((evening - tonight) / 86400000);
  const night = sunInfo(date).night;
  if (days === 0) return night ? 'Tonight' : 'Today';
  if (days === 1) return night ? 'Tomorrow night' : 'Tomorrow';
  if (days === -1) return night ? 'Last night' : 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long' });
}
