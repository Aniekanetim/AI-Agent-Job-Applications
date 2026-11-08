export type Schedule =
  | { kind: "onDemand" }
  | { kind: "weekly"; everyWeeks: number; anchor: string; slots: { day: number; time: string }[] }
  | { kind: "monthly"; day: number | "last"; time: string };

const dayMs = 86_400_000;
export const slotMs = 60_000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const validClock = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDay = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && isoDay(Date.parse(value)) === value;
export const validInstant = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function localClock(zone: string) {
  if (typeof zone !== "string" || !zone || /^[+-]/.test(zone)) throw new Error("Choose a named publishing time zone.");
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch { throw new Error("Choose a valid named publishing time zone."); }
}

export function validateSchedule(rule: unknown, zone: string): asserts rule is Schedule {
  localClock(zone);
  const r = rule as Schedule;
  if (r?.kind === "onDemand") return;
  if (r?.kind === "weekly" && validDay(r.anchor) && Number.isInteger(r.everyWeeks) && r.everyWeeks >= 1 && r.everyWeeks <= 52 &&
    Array.isArray(r.slots) && r.slots.length >= 1 && r.slots.length <= 28 &&
    r.slots.every(slot => slot && Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6 && validClock(slot.time)) &&
    new Set(r.slots.map(slot => `${slot.day}/${slot.time}`)).size === r.slots.length) return;
  if (r?.kind === "monthly" && (r.day === "last" || Number.isInteger(r.day) && r.day >= 1 && r.day <= 31) && validClock(r.time)) return;
  throw new Error("Use on-demand, a weekly interval with distinct day/time slots, or a monthly day and time.");
}

/** Calendar arithmetic stays in local dates. A repeated local minute uses its first occurrence. */
export function nextSlots(rule: Schedule, zone: string, after: string, count = 3): string[] {
  validateSchedule(rule, zone);
  if (!validInstant(after) || !Number.isInteger(count) || count < 1 || count > 10) throw new Error("Use a valid schedule preview time.");
  if (rule.kind === "onDemand") return [];
  const formatter = localClock(zone);
  const now = Date.parse(after), firstDay = Date.parse(formatter.format(now).slice(0, 10));
  const result: string[] = [];
  for (let day = firstDay; day < firstDay + 3660 * dayMs && result.length < count; day += dayMs) {
    const date = new Date(day), times: string[] = [];
    if (rule.kind === "monthly") {
      const isLast = new Date(day + dayMs).getUTCDate() === 1;
      if (rule.day === (isLast ? "last" : 0) || rule.day === date.getUTCDate()) times.push(rule.time);
    } else {
      const anchor = Date.parse(rule.anchor), week = (value: number) => value - new Date(value).getUTCDay() * dayMs;
      const weeks = (week(day) - week(anchor)) / (7 * dayMs);
      if (day >= anchor && weeks % rule.everyWeeks === 0) times.push(...rule.slots.filter(slot => slot.day === date.getUTCDay()).map(slot => slot.time));
    }
    for (const time of times.sort()) {
      const local = `${isoDay(day)} ${time}`, nominal = Date.parse(`${isoDay(day)}T${time}:00Z`);
      const offsets = [-dayMs, 0, dayMs].map(delta => {
        const probe = nominal + delta;
        return Date.parse(formatter.format(probe).replace(" ", "T") + ":00Z") - probe;
      });
      const first = offsets.map(offset => nominal - offset).filter(instant => formatter.format(instant) === local).sort((a, b) => a - b)[0];
      if (first > now) result.push(new Date(first).toISOString());
      if (result.length === count) break;
    }
  }
  return result;
}

export function isSlot(rule: Schedule, zone: string, at: string) {
  if (!validInstant(at)) return false;
  return nextSlots(rule, zone, new Date(Date.parse(at) - 1).toISOString(), 1)[0] === at;
}
