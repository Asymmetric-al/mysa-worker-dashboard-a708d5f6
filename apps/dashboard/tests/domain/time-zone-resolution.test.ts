/** Proves the one question a request's time-zone parameter is judged by: whether this runtime resolves the identifier it names. */
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { isResolvableTimeZone, todayInZone } from "@/modules/time/civil";
const SEED_INSTANT = Temporal.Instant.from("2026-11-20T00:00:00Z");
const RESOLVABLE = ["UTC", "utc", "Europe/London", "America/Santiago", "Pacific/Auckland", "Asia/Tokyo"];
const UNRESOLVABLE = ["Mars/Olympus", "Mars/Phobos", "UTC+1", "", "   "];
describe("the time-zone identifier a request states", () => {
  it.each(RESOLVABLE)("accepts %s, because this runtime resolves it", (timeZone) => expect(isResolvableTimeZone(timeZone)).toBe(true));
  it.each(UNRESOLVABLE)("refuses %j, because no calendar day can be read in it", (timeZone) => expect(isResolvableTimeZone(timeZone)).toBe(false));
  it.each([...RESOLVABLE, ...UNRESOLVABLE])("answers %j exactly as the reader that would use it does", (timeZone) => {
    expect(isResolvableTimeZone(timeZone)).toBe(todayInZone(timeZone, SEED_INSTANT).status === "resolved");
  });
});
