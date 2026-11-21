import { z } from "zod";

import { parseCivilDate } from "@/modules/time/civil";

/**
 * A civil date carried as `YYYY-MM-DD` and read by `@/modules/time/civil`.
 *
 * Shape and calendar in one check: `2026-02-31` has the shape of a date yet names no day, so it is
 * refused rather than rolled forward into March. The calendar is read by the one civil-date
 * implementation, so this client schema cannot answer differently from the service for one value,
 * and no time of day, zone or instant is invented for the day the worker chose.
 */
export const civilDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (parseCivilDate(value).status === "refused") {
      ctx.addIssue({ code: "custom", message: "Enter a real calendar date as YYYY-MM-DD." });
    }
  });

/**
 * Builds a trimmed text field whose length is bounded in Unicode code points.
 */
export function boundedTextSchema(
  maxCodePoints: number,
  messages: { readonly required: string; readonly tooLong: string },
): z.ZodString {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      // `.min`/`.max` count UTF-16 code units and would reject a valid astral-plane value,
      // so the length is measured in code points here instead.
      const length = Array.from(value).length;
      if (length === 0) {
        ctx.addIssue({ code: "custom", message: messages.required });
      } else if (length > maxCodePoints) {
        ctx.addIssue({ code: "custom", message: messages.tooLong });
      }
    });
}

/**
 * Validates the `createInitiative` payload.
 */
export const createInitiativePayloadSchema = z
  .object({
    name: boundedTextSchema(200, {
      required: "Give the initiative a name.",
      tooLong: "Keep the name to 200 characters or fewer.",
    }),
    purpose: boundedTextSchema(2000, {
      required: "Describe what this initiative is for.",
      tooLong: "Keep the purpose to 2,000 characters or fewer.",
    }),
    // An opaque principal reference inside the acting scope. A name or an email address
    // never establishes identity, so neither is accepted in its place.
    responsiblePrincipalId: z
      .string()
      .trim()
      .min(1, "Choose the person responsible for this initiative."),
    // The acting ministry travels in the mutation's scope, so a body may never name a
    // context the caller is not admitted to; omit the key rather than sending null.
    period: z.object({ startOn: civilDateSchema, endOn: civilDateSchema }).strict().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A date that names no day is already refused on its own field, so the period is ordered only
    // when both ends name real days: otherwise the ordering message would blame the order for a
    // value the calendar refused. Each end is read by the one civil-date implementation, and only
    // then do the ISO strings order them as calendar days without a second date implementation.
    if (value.period === undefined) return;
    if (
      parseCivilDate(value.period.startOn).status === "refused" ||
      parseCivilDate(value.period.endOn).status === "refused"
    ) {
      return;
    }
    if (value.period.endOn < value.period.startOn) {
      ctx.addIssue({
        code: "custom",
        message: "Choose an end date on or after the start date.",
        path: ["period", "endOn"],
      });
    }
  });

/** A civil date carried as an ISO `YYYY-MM-DD` string. */
export type CivilDateString = z.infer<typeof civilDateSchema>;

/** The validated `createInitiative` payload. */
export type CreateInitiativePayload = z.infer<typeof createInitiativePayloadSchema>;
