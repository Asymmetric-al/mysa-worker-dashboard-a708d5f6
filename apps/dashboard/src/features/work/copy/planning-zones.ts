/**
 * The time zones this family's composer offers for a planned meeting time.
 *
 * A planned time is a wall clock plus the zone it is stated in, so the zone is a field the worker chooses
 * and never one that is assumed (AAP 0.8.2). A native select needs a bounded list to be usable with a
 * keyboard, so this list states real IANA names — every one of which this runtime resolves — and the
 * composer adds the display zone it was handed whenever that zone is not already stated here. A zone the
 * list does not carry is still readable: an existing meeting states its own zone in words beside the task.
 */
export const PLANNING_TIME_ZONE_CHOICES: readonly string[] = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
