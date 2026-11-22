import { z } from "zod";
import { contentIdSchema } from "./draft";
/**
 * The body one notice request states: the edition it is submitted for, the eligible ceiling the person acknowledged,
 * and — only when a definite failure is submitted again — the notice that failure was recorded on.
 *
 * A repeat is named by the notice it repeats rather than by the recipient it is about: the service decides which
 * copies of that notice definitely failed, and an accepted or uncertain copy is never repeated whatever a caller asks
 * for. The instant such a request states is the repeated notice's own, which is the window it stands in — the service
 * reads both from the record and refuses a request whose useful hours are spent. No recipient list or dedupe key is
 * computed here, so the identity a repeat is recognised by is the record's own.
 */
export const requestNotificationSchema = z.strictObject(
  {
    documentId: contentIdSchema,
    variantId: contentIdSchema,
    releaseId: contentIdSchema,
    acknowledgedCeiling: z
      .number({ error: "A notice request states the ceiling you acknowledged as a number, so submit it from the " + "publish review screen rather than building one by hand." })
      .int("State the ceiling as a whole number — the eligible count the review screen showed you.")
      .min(0, "A ceiling is a count, so the lowest it can be is zero: zero means nobody is eligible " + "for this notice right now."),
    repeatOfIntentId: contentIdSchema.optional(),
    intendedAt: z.iso.datetime({ offset: true, error: "A notice's intended instant is the one its record states, so take it from the notice rather than writing one here." }).optional(),
  },
  { error: "A notice request carries the release it is submitted for and the ceiling you acknowledged, and nothing else " + "besides the notice a repeat names and the instant that notice was meant for, so submit it from the publish review " + "screen or the delivery results." },
);
export type RequestNotificationPayload = z.infer<typeof requestNotificationSchema>;
