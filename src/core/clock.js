// A clock is any object with now() returning a Date. Code that needs the time
// takes a clock so tests can control it.

export const systemClock = {
  now: () => new Date(),
};

export function fakeClock(iso = '2026-11-15T01:00:00Z') {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
  };
}
