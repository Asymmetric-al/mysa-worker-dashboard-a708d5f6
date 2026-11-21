import { z } from "zod";
import { boundedTextSchema, civilDateSchema } from "./initiative";
// Requested terms are what the worker asked for, never support that was received, and a presentation
// record describes how an ask was made rather than claiming a send, a delivery or a provider outcome.
// These schemas are the client's shape and fail fast; the data service validates authoritatively.
/** The versioned terms one ask carries: exact requested money, or a non-financial ask, never both. */
export const requestedTermsSchema = z
  .object({
    version: z.number({ error: "Record which terms version this ask carries." }).int("Record which terms version this ask carries."),
    currency: z.string({ error: "Choose the currency for the requested amount." }).trim().min(1, "Choose the currency for the requested amount.").optional(),
    // A zero is never the way to say "non-financial" — that is what nonFinancial is for — and whether
    // a zero ask is acceptable is the service's decision, so no positive check or maximum lives here.
    minorUnits: z.number({ error: "Enter the requested amount in minor units." }).optional(),
    cadence: z.string({ error: "Enter the cadence or leave it empty." }).trim().min(1, "Enter the cadence or leave it empty.").optional(),
    term: z.string({ error: "Enter the term or leave it empty." }).trim().min(1, "Enter the term or leave it empty.").optional(),
    nonFinancial: z
      .object({
        description: boundedTextSchema(2000, {
          required: "Describe the non-financial ask.",
          tooLong: "Keep the description to 2,000 characters or fewer.",
        }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((terms, ctx) => {
    if (!Number.isSafeInteger(terms.version) || terms.version <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["version"],
        message: "Record which terms version this ask carries.",
      });
    }
    const hasMoneyField = terms.currency !== undefined || terms.minorUnits !== undefined || terms.cadence !== undefined || terms.term !== undefined;
    if (terms.nonFinancial !== undefined) {
      if (hasMoneyField) {
        ctx.addIssue({
          code: "custom",
          path: ["nonFinancial"],
          message: "A non-financial ask carries no amount, currency, cadence or term.",
        });
      }
      return;
    }
    if (!hasMoneyField) {
      ctx.addIssue({
        code: "custom",
        path: ["nonFinancial"],
        message: "Choose requested financial terms (currency and amount) or describe a non-financial ask.",
      });
      return;
    }
    if (terms.currency === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Choose the currency for the requested amount.",
      });
    }
    if (terms.minorUnits === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["minorUnits"],
        message: "Enter the requested amount in minor units.",
      });
    } else if (!Number.isSafeInteger(terms.minorUnits)) {
      ctx.addIssue({
        code: "custom",
        path: ["minorUnits"],
        message: "Enter the amount as a whole number of minor units.",
      });
    }
  });
/** The requested terms an ask carries, ready to travel with draftRequest. */
export type RequestedTerms = z.infer<typeof requestedTermsSchema>;
/** The client payload of draftRequest: who is asked, who they represent, why, and on which terms. */
export const draftRequestPayloadSchema = z
  .object({
    initiativeId: z
      .string({
        error: "This change is missing the initiative it belongs to; reopen the initiative and try again.",
      })
      .trim()
      .min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
    recipientPartnerId: z
      .string({
        error: "Choose the person or organization this request is for.",
      })
      .trim()
      .min(1, "Choose the person or organization this request is for."),
    // A separate opaque reference: an organization representative is its own record, so this is
    // never derived from, compared with, or defaulted to the recipient.
    representedOrganizationId: z
      .string({
        error: "Choose the organization this person represents, or leave it empty.",
      })
      .trim()
      .min(1, "Choose the organization this person represents, or leave it empty.")
      .optional(),
    purpose: boundedTextSchema(2000, {
      required: "Describe the purpose of this request.",
      tooLong: "Keep the purpose to 2,000 characters or fewer.",
    }),
    terms: requestedTermsSchema,
  })
  .strict();
/** The client payload of draftRequest as the composer submits it. */
export type DraftRequestPayload = z.infer<typeof draftRequestPayloadSchema>;
/** The client payload of presentRequest: what was presented, on which civil date, on which terms version. */
export const presentRequestPayloadSchema = z
  .object({
    initiativeId: z
      .string({
        error: "This change is missing the initiative it belongs to; reopen the initiative and try again.",
      })
      .trim()
      .min(1, "This change is missing the initiative it belongs to; reopen the initiative and try again."),
    requestId: z
      .string({
        error: "This change is missing the request it belongs to; reopen the request and try again.",
      })
      .trim()
      .min(1, "This change is missing the request it belongs to; reopen the request and try again."),
    presentedOn: civilDateSchema,
    manner: boundedTextSchema(200, {
      required: "Describe how the request was presented.",
      tooLong: "Keep the description to 200 characters or fewer.",
    }),
    versionRef: z.string({ error: "Record which terms version was presented." }).trim().min(1, "Record which terms version was presented."),
  })
  .strict();
/** The client payload of presentRequest as the composer submits it. */
export type PresentRequestPayload = z.infer<typeof presentRequestPayloadSchema>;
