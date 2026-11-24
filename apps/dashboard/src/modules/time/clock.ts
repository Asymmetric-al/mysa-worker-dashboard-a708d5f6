import { Temporal } from "temporal-polyfill";
export const SEED_INSTANT: Temporal.Instant = Temporal.Instant.from("2026-11-20T00:00:00Z");
let clockOffsetMilliseconds = 0;
function assertSafeMilliseconds(value: number, subject: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${subject} must be a safe integer number of milliseconds`);
}
/** The scenario instant at a stated offset from `SEED_INSTANT`. */ export function instantAt(offsetMilliseconds: number): Temporal.Instant {
  assertSafeMilliseconds(offsetMilliseconds, "Clock offset");
  return SEED_INSTANT.add({ milliseconds: offsetMilliseconds });
}
export const now = (): Temporal.Instant => instantAt(clockOffsetMilliseconds);
/** Replaces the process clock offset from `SEED_INSTANT`; `setClockOffset(0)` restores the known seed instant, which is what a seed reset does. */ export function setClockOffset(offsetMilliseconds: number): void {
  assertSafeMilliseconds(offsetMilliseconds, "Clock offset");
  clockOffsetMilliseconds = offsetMilliseconds;
}
/** Moves the process clock forward by a stated positive amount, for the development control that steps a scenario across a boundary. */ export function advanceClockOffset(byMilliseconds: number): void {
  if (!Number.isSafeInteger(byMilliseconds) || byMilliseconds <= 0) throw new RangeError("A clock advance must be a positive safe integer number of milliseconds");
  const advanced = clockOffsetMilliseconds + byMilliseconds;
  if (!Number.isSafeInteger(advanced)) throw new RangeError("A clock advance must keep the clock offset a safe integer");
  clockOffsetMilliseconds = advanced;
}
