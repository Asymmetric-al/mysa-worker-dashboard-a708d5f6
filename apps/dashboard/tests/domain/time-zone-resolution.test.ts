/**
 * Proves the one question a request's time-zone parameter is judged by: whether this runtime
 * resolves the identifier it names.
 *
 * Plan items that put this file in scope: AAP 0.1.1 ("Time is a domain input … zones are declared
 * rather than assumed"), 0.7.1 (a refused request is `invalid` with a per-field message, while
 * `unavailable` is reserved for a source that is down) and 0.15.1 ("all boundary arithmetic goes
 * through `modules/time`"). The browser transports for `GET /api/tasks` and `GET /api/partners`
 * refuse a zone by field before any read runs, and they ask this module rather than restating the
 * rule, so the predicate they rely on is asserted here once.
 *
 * Two facts are proved, and nothing else is claimed:
 *
 * - an identifier this runtime resolves is accepted and one it cannot resolve is refused, over a
 *   table of both, including the blank and the padded-blank values a query string can actually
 *   carry;
 * - the transport's answer and the reader's answer agree, because the predicate is asked of the same
 *   conversion `todayInZone` uses — a transport that accepted a zone a read then refused would turn
 *   the caller's mistake back into an outage.
 */
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import { isResolvableTimeZone, todayInZone } from "@/modules/time/civil";

/** The instant every case is resolved at: the seed instant, stated rather than read from a clock. */
const SEED_INSTANT = Temporal.Instant.from("2026-11-20T00:00:00Z");

/**
 * An identifier a caller can legitimately send, and the value the runtime has for it. Zone
 * identifiers are matched case-insensitively, so "utc" resolves to the same zone "UTC" names.
 */
const RESOLVABLE = [
  "UTC",
  "utc",
  "Europe/London",
  "America/Santiago",
  "Pacific/Auckland",
  "Asia/Tokyo",
];

/** An identifier no time-zone database resolves, plus the two blank forms a query string carries. */
const UNRESOLVABLE = ["Mars/Olympus", "Mars/Phobos", "UTC+1", "", "   "];

describe("the time-zone identifier a request states", () => {
  it.each(RESOLVABLE)("accepts %s, because this runtime resolves it", (timeZone) => {
    expect(isResolvableTimeZone(timeZone)).toBe(true);
  });

  it.each(UNRESOLVABLE)("refuses %j, because no calendar day can be read in it", (timeZone) => {
    expect(isResolvableTimeZone(timeZone)).toBe(false);
  });

  it.each([...RESOLVABLE, ...UNRESOLVABLE])(
    "answers %j exactly as the reader that would use it does",
    (timeZone) => {
      const readerResolved = todayInZone(timeZone, SEED_INSTANT).status === "resolved";
      expect(isResolvableTimeZone(timeZone)).toBe(readerResolved);
    },
  );
});
