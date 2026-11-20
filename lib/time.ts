const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    cache.set(timeZone, f);
  }
  return f;
}

export type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function partsInZone(ms: number, timeZone: string): ZoneParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMinutes(timeZone: string, ms: number): number {
  const p = partsInZone(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC epoch. Two passes settle
 * the offset so this stays correct across DST transitions.
 */
export function zonedToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetMinutes(timeZone, guess) * 60000;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export function localDate(ms: number, timeZone: string): { year: number; month: number; day: number } {
  const p = partsInZone(ms, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export function weekday(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function formatTime(ms: number, timeZone: string): string {
  const p = partsInZone(ms, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function formatDateTime(ms: number, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(ms));
  return `${day}, ${formatTime(ms, timeZone)}`;
}
