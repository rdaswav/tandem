// Week and date maths. Dates are 'YYYY-MM-DD' strings in a named time zone.
// Time zone work uses Intl only, no date library. Day arithmetic is done on
// calendar dates in UTC so daylight saving never shifts a result.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseDate(dateString) {
  const m = DATE_RE.exec(dateString);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${dateString}`);
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() !== Number(mo) - 1 ||
    back.getUTCDate() !== Number(d)
  ) {
    throw new RangeError(`not a real calendar date: ${dateString}`);
  }
  return ms;
}

function formatDate(ms) {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// The local calendar date of an instant (Date, ISO string or epoch ms) in tz.
export function localDate(instant, tz) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid instant');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// 0 is Sunday, 6 is Saturday.
export function dayOfWeek(dateString) {
  return new Date(parseDate(dateString)).getUTCDay();
}

export function addDays(dateString, n) {
  return formatDate(parseDate(dateString) + n * DAY_MS);
}

// Whole days from a to b. Negative when b is earlier.
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

// The local date of the most recent start day at or before the instant.
export function weekStart(instant, tz, startDay) {
  if (!Number.isInteger(startDay) || startDay < 0 || startDay > 6) {
    throw new RangeError('startDay must be an integer from 0 to 6');
  }
  const date = localDate(instant, tz);
  const back = (dayOfWeek(date) - startDay + 7) % 7;
  return addDays(date, -back);
}
