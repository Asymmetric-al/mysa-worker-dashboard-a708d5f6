import { z } from "zod";
import { contentIdSchema } from "./draft";
export const requestNotificationSchema = z.strictObject(
  {
    documentId: contentIdSchema,
    variantId: contentIdSchema,
    releaseId: contentIdSchema,
    acknowledgedCeiling: z
      .number({ error: "A notice request states the ceiling you acknowledged as a number, so submit it from the " + "publish review screen rather than building one by hand." })
      .int("State the ceiling as a whole number — the eligible count the review screen showed you.")
      .min(0, "A ceiling is a count, so the lowest it can be is zero: zero means nobody is eligible " + "for this notice right now."),
  },
  { error: "A notice request carries the release it is submitted for and the ceiling you acknowledged, " + "and nothing else, so submit it from the publish review screen." },
);
export type RequestNotificationPayload = z.infer<typeof requestNotificationSchema>;
