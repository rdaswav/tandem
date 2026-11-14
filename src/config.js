import path from 'node:path';

export function loadConfig(env = process.env) {
  const startDay = Number.parseInt(env.CHECKIN_START_DAY ?? '0', 10);
  return {
    port: Number.parseInt(env.PORT ?? '8790', 10),
    dataDir: env.DATA_DIR ?? path.resolve('data'),
    tz: env.TZ ?? 'Australia/Melbourne',
    checkinStartDay: Number.isInteger(startDay) && startDay >= 0 && startDay <= 6 ? startDay : 0,
    log: false,
  };
}
