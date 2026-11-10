// UK wall-clock helpers (the grid data is Great Britain, so times are shown in UK time).
import { SLOT_MS } from './plan.ts';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export interface UkParts { weekday: string; day: number; month: string; hour: number; minute: number }

export function ukParts(t: number): UkParts {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, day: Number(p.day), month: p.month, hour: Number(p.hour), minute: Number(p.minute) };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "03:30" */
export const clock = (t: number) => { const p = ukParts(t); return `${pad(p.hour)}:${pad(p.minute)}`; };
/** "Thu 03:30" */
export const dayClock = (t: number) => `${ukParts(t).weekday} ${clock(t)}`;
/** "Thu 12 Nov" */
export const dayLabel = (t: number) => { const p = ukParts(t); return `${p.weekday} ${p.day} ${p.month}`; };

/**
 * Default deadline: the first 07:00 UK time that leaves room for the run plus an hour of choice,
 * as a slot index (the run must end by the start of this slot). Falls back to the horizon end.
 */
export function defaultDeadline(start: number, horizon: number, nowIndex: number, slots: number): number {
  for (let i = nowIndex + slots + 2; i <= horizon; i++) {
    const p = ukParts(start + i * SLOT_MS);
    if (p.hour === 7 && p.minute === 0) return i;
  }
  return horizon;
}

/** A calendar file with one reminder at `t` (epoch ms). */
export function ics(t: number, minutes: number, title: string, note: string, now = Date.now()): string {
  const z = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Grid Tide//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${t}-${title.replace(/\W+/g, '').toLowerCase()}@grid-tide`,
    `DTSTAMP:${z(now)}`, `DTSTART:${z(t)}`, `DTEND:${z(t + minutes * 60000)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(note)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
