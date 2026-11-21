/**
 * The notification payload schema — `requestNotification`, the one submission that asks for a notice
 * to go to the readers already eligible for an Update release that has been published.
 */
import { z } from "zod";
import { contentIdSchema } from "./draft";
// The one notification payload
/** Feeds `requestNotification`: the exact release a notice is submitted for, and the ceiling the worker acknowledged on the publish review screen. */
export const requestNotificationSchema = z.strictObject(
  {
    documentId: contentIdSchema,
    variantId: contentIdSchema,
    releaseId: contentIdSchema,
    acknowledgedCeiling: z
      .number({
        error: "A notice request states the ceiling you acknowledged as a number, so submit it from the " + "publish review screen rather than building one by hand.",
      })
      .int("State the ceiling as a whole number — the eligible count the review screen showed you.")
      .min(0, "A ceiling is a count, so the lowest it can be is zero: zero means nobody is eligible " + "for this notice right now."),
  },
  {
    error: "A notice request carries the release it is submitted for and the ceiling you acknowledged, " + "and nothing else, so submit it from the publish review screen.",
  },
);
// Payload type: inferred from the schema, never written beside it
/** The payload `requestNotification` accepts, inferred so the publish review form and its hook cannot hold a second shape. */
export type RequestNotificationPayload = z.infer<typeof requestNotificationSchema>;
