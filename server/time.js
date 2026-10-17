// Every time in the journal is NEW YORK wall-clock time ("YYYY-MM-DDTHH:MM:SS",
// no zone suffix): the futures market's clock. CSV exports carry the uploader's
// local time with no zone, so imports convert from the browser's time zone
// (sent with the upload) to NY once, at the door. Everything downstream (stats,
// analytics, patterns, calendars, day keys) can then read hours/dates straight
// off the string.
export const NY = 'America/New_York';

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}

// Wall-clock string of an instant (ms) in `tz`.
export function wallAt(ms, tz = NY) {
  const o = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}`;
}

export function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

// The instant at which `tz`'s wall clock reads `wall` (DST-aware; a few
// fixed-point passes settle the zone offset).
function wallToInstant(wall, tz) {
  const target = Date.parse(`${wall}Z`);
  let ms = target;
  for (let i = 0; i < 3; i++) ms += target - Date.parse(`${wallAt(ms, tz)}Z`);
  return ms;
}

// Convert a wall-clock string from `fromTz` to New York wall-clock.
export function toNY(wall, fromTz) {
  if (!wall || !fromTz || fromTz === NY || !validTz(fromTz)) return wall;
  return wallAt(wallToInstant(wall, fromTz), NY);
}

// Today's date (YYYY-MM-DD) in New York.
export const nyToday = () => wallAt(Date.now(), NY).slice(0, 10);
