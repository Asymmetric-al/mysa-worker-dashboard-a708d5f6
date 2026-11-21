/**
 * The scenario clock — the only source of now in this application.
 *
 * Every time boundary the release defines (a referral window's exclusive endpoint, a coaching
 * share cutoff, the 24-hour notification usefulness window, the 168-hour confirmation window, a
 * recurrence's next admitted date) is a pure function of `(input, now)`, evaluated at read or
 * command time by `window.ts` and `recurrence.ts`. This module supplies that `now` as an offset
 * from one fixed seed instant, so any scenario can be replayed exactly.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Time modules": `src/modules/time/*` with the key interfaces `now()`,
 *   `newWindowEnd()`, `continuedWindowEnd()`, `shareCutoff()`, `notificationDeadline()`,
 *   `confirmationDeadline()`, `nextOccurrences()` and `monthlyOnDay()`. The boundary functions
 *   live in the sibling modules; `now()` and the controls that move it live here.
 * - AAP 0.7.2 "The controllable local clock": `readDevState` exposes the scenario clock,
 *   `setClock` sets an offset from the seed instant and `advanceClock` moves it forward by a
 *   stated amount. These are the only two names that change time, and nothing observes the clock
 *   in the background.
 * - AAP 0.9.1 repository tree and the 0.11.1 File Creation Plan row
 *   `modules/time/{clock,civil,window,recurrence}.ts`.
 * - Assumption A12: the scenario clock is an offset advanced only by the development control, and
 *   every boundary is evaluated at read or command time with no background job.
 *
 * Layering: a framework-free domain module, importable from either side of the data service, that
 * imports nothing from this repository. Its single import is the default `temporal-polyfill`
 * entrypoint, which uses Node 26's native `Temporal` when present and behaves identically when it
 * is absent. Loading this module has no side effect: it reads no clock, no file and no
 * environment. It is exercised directly by the domain tests for the boundaries that consume it
 * (`tests/domain/{referral-window,recurrence,notification-window,confirmation-window}.test.ts`)
 * and brings no test framework, coverage target or background job of its own.
 */
import { Temporal } from "temporal-polyfill";

/**
 * The single fixed anchor every seeded timestamp and every scenario offset is relative to: the
 * specification's revision date at midnight UTC, so the seed's civil dates are unambiguous. It is
 * never read from the machine clock, never configurable and never redefined.
 */
export const SEED_INSTANT: Temporal.Instant = Temporal.Instant.from("2026-11-20T00:00:00Z");

/**
 * The process-wide offset from `SEED_INSTANT`, private so the clock starts exactly at the seed
 * instant and can move only through the two controls below.
 *
 * Per-session caveat: this is the process-level offset. The authoritative offset is persisted per
 * session by `dev-runtime` in `<sessionId>.meta.json`, because sessions in different scenarios run
 * at the same time. A caller acting for one session derives its instant from that session's
 * persisted offset through `instantAt`, or hands that instant to a boundary function as its `now`
 * argument; it never reads a second clock.
 */
let clockOffsetMilliseconds = 0;

/**
 * Rejects anything that is not a safe integer number of milliseconds. Only the development runtime
 * can reach this, and only by a programming error: mutation payloads are validated before they
 * arrive here, so user input never throws from this module.
 */
function assertSafeMilliseconds(value: number, subject: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${subject} must be a safe integer number of milliseconds`);
  }
}

/**
 * The scenario instant at a stated offset from `SEED_INSTANT`. `now()` applies this same formula
 * to the current process offset; it is exported so a caller holding a session's persisted offset
 * derives the identical instant without introducing a second clock.
 */
export function instantAt(offsetMilliseconds: number): Temporal.Instant {
  assertSafeMilliseconds(offsetMilliseconds, "Clock offset");
  return SEED_INSTANT.add({ milliseconds: offsetMilliseconds });
}

/**
 * The current scenario instant — the only source of now for every read, mutation and boundary
 * evaluation. It is a pure read of module state: two consecutive calls return the same instant
 * until the offset is deliberately moved.
 */
export function now(): Temporal.Instant {
  return instantAt(clockOffsetMilliseconds);
}

/**
 * Replaces the process clock offset from `SEED_INSTANT`; `setClockOffset(0)` restores the known
 * seed instant, which is what a seed reset does.
 *
 * @internal Only `dev-runtime/scenario.ts` and `dev-runtime/reset.ts` may call this. The
 * development runtime owns scenario selection and offset persistence, and nothing in a request
 * path may move the clock.
 */
export function setClockOffset(offsetMilliseconds: number): void {
  assertSafeMilliseconds(offsetMilliseconds, "Clock offset");
  clockOffsetMilliseconds = offsetMilliseconds;
}

/**
 * Moves the process clock forward by a stated positive amount, for the development control that
 * steps a scenario across a boundary.
 *
 * @internal Only `dev-runtime/scenario.ts` and `dev-runtime/reset.ts` may call this, for the same
 * reason as `setClockOffset`: a request path must never move the clock it is being evaluated
 * against.
 */
export function advanceClockOffset(byMilliseconds: number): void {
  if (!Number.isSafeInteger(byMilliseconds) || byMilliseconds <= 0) {
    throw new RangeError("A clock advance must be a positive safe integer number of milliseconds");
  }
  const advanced = clockOffsetMilliseconds + byMilliseconds;
  // Keeps the invariant `instantAt` relies on: the stored offset stays a safe integer, so the
  // derived instant is always exact.
  if (!Number.isSafeInteger(advanced)) {
    throw new RangeError("A clock advance must keep the clock offset a safe integer");
  }
  clockOffsetMilliseconds = advanced;
}
