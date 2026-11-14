import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOfWeek, daysBetween, localDate, weekStart } from '../src/core/week.js';
import { fakeClock, systemClock } from '../src/core/clock.js';

const MEL = 'Australia/Melbourne';

// [label, instant, tz, startDay, expected week start]
const weekStartRows = [
  ['Saturday in UTC is already Sunday in Melbourne', '2026-11-14T13:30:00Z', MEL, 0, '2026-11-15'],
  ['the same instant in UTC is still Saturday', '2026-11-14T13:30:00Z', 'UTC', 0, '2026-11-08'],
  ['the start day itself returns that date', '2026-11-15T03:00:00Z', MEL, 0, '2026-11-15'],
  ['midweek returns the previous Sunday', '2026-11-18T00:00:00Z', MEL, 0, '2026-11-15'],
  ['last minute of the local Saturday', '2026-11-21T12:59:00Z', MEL, 0, '2026-11-15'],
  ['first minute of the next local Sunday', '2026-11-21T13:00:00Z', MEL, 0, '2026-11-22'],
  ['start day 1: Sunday belongs to the week before', '2026-11-15T02:00:00Z', MEL, 1, '2026-11-09'],
  ['start day 1: the Monday itself', '2026-11-16T02:00:00Z', MEL, 1, '2026-11-16'],
  ['start day 6 (Saturday): a Friday looks back six days', '2026-11-20T02:00:00Z', MEL, 6, '2026-11-14'],
  ['daylight saving ends: 00:00 AEDT Sunday', '2026-04-04T13:00:00Z', MEL, 0, '2026-04-05'],
  ['daylight saving ends: 23:59 AEDT Saturday', '2026-04-04T12:59:00Z', MEL, 0, '2026-03-29'],
  ['daylight saving ends: repeated 02:30 hour, after the change', '2026-04-04T16:30:00Z', MEL, 0, '2026-04-05'],
  ['daylight saving ends: repeated 02:30 hour, before the change', '2026-04-04T15:30:00Z', MEL, 0, '2026-04-05'],
  ['daylight saving starts: 23:59 AEST Saturday', '2026-10-03T13:59:00Z', MEL, 0, '2026-09-27'],
  ['daylight saving starts: 00:00 AEST Sunday', '2026-10-03T14:00:00Z', MEL, 0, '2026-10-04'],
  ['daylight saving starts: 01:59 AEST, just before the jump', '2026-10-03T15:59:00Z', MEL, 0, '2026-10-04'],
  ['year boundary: Thursday 1 January looks back into December', '2026-01-01T05:00:00Z', MEL, 0, '2025-12-28'],
  ['a zone west of UTC: Saturday evening in Los Angeles', '2026-11-15T03:00:00Z', 'America/Los_Angeles', 0, '2026-11-08'],
];

for (const [label, instant, tz, startDay, expected] of weekStartRows) {
  test(`weekStart: ${label}`, () => {
    assert.equal(weekStart(instant, tz, startDay), expected);
  });
}

test('weekStart accepts a Date and epoch milliseconds', () => {
  const iso = '2026-11-18T00:00:00Z';
  assert.equal(weekStart(new Date(iso), MEL, 0), '2026-11-15');
  assert.equal(weekStart(Date.parse(iso), MEL, 0), '2026-11-15');
});

test('weekStart rejects a bad start day', () => {
  for (const bad of [-1, 7, 1.5, '0', undefined]) {
    assert.throws(() => weekStart('2026-11-18T00:00:00Z', MEL, bad), RangeError);
  }
});

test('localDate', () => {
  assert.equal(localDate('2026-11-14T13:30:00Z', MEL), '2026-11-15');
  assert.equal(localDate('2026-11-14T13:30:00Z', 'UTC'), '2026-11-14');
  assert.throws(() => localDate('not a date', MEL), RangeError);
});

test('dayOfWeek', () => {
  assert.equal(dayOfWeek('2026-11-15'), 0);
  assert.equal(dayOfWeek('2026-11-14'), 6);
  assert.equal(dayOfWeek('2026-11-16'), 1);
});

const addDaysRows = [
  ['2026-02-28', 1, '2026-03-01'],
  ['2026-03-01', -1, '2026-02-28'],
  ['2024-02-28', 1, '2024-02-29'],
  ['2024-02-29', 1, '2024-03-01'],
  ['2025-12-31', 1, '2026-01-01'],
  ['2026-01-01', -1, '2025-12-31'],
  ['2026-11-15', 0, '2026-11-15'],
  ['2026-11-15', 7, '2026-11-22'],
  ['2026-04-05', -7, '2026-03-29'],
];

for (const [start, n, expected] of addDaysRows) {
  test(`addDays(${start}, ${n}) is ${expected}`, () => {
    assert.equal(addDays(start, n), expected);
  });
}

test('addDays rejects a malformed or impossible date', () => {
  assert.throws(() => addDays('2026-2-3', 1), RangeError);
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-01-04', '2026-01-11'), 7);
  assert.equal(daysBetween('2026-01-11', '2026-01-04'), -7);
  assert.equal(daysBetween('2026-11-15', '2026-11-15'), 0);
  assert.equal(daysBetween('2025-12-28', '2026-01-04'), 7);
  assert.equal(daysBetween('2026-04-04', '2026-04-06'), 2);
  assert.equal(daysBetween('2026-10-03', '2026-10-05'), 2);
});

test('fakeClock returns copies and can be moved', () => {
  const clock = fakeClock('2026-11-15T01:00:00Z');
  const first = clock.now();
  first.setUTCFullYear(1999);
  assert.equal(clock.now().toISOString(), '2026-11-15T01:00:00.000Z');
  clock.set('2026-11-16T05:00:00Z');
  assert.equal(clock.now().toISOString(), '2026-11-16T05:00:00.000Z');
});

test('systemClock returns the present', () => {
  const before = Date.now();
  const t = systemClock.now().getTime();
  assert.ok(t >= before && t <= Date.now() + 1000);
});
