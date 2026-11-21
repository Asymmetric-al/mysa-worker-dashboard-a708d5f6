/**
 * `GET /api/coaching/subjects` — the read-only coach view: the coach's own portfolio, or one admitted
 * subject's shared modules (plan rows 0.6.3 coaching contract, 0.7.1 "Read as a coach", 0.8.4, and the
 * criteria 16 and 19 evidence).
 *
 * One request names exactly one selector and never an identity: `view=portfolio` reads the whole
 * portfolio, `subjectId=<opaque id>` reads one subject, which the service addresses as `grantId`. The
 * acting coach is resolved from the development-session cookie inside the service, so an identity-shaped
 * parameter is refused by name rather than ignored — a caller must never believe one took effect.
 *
 * A selector that fails validation answers through `outcomeFromError`, the index's one mapper from a
 * `ZodError` to the closed `invalid` outcome, because the data-service index does not re-export the
 * `invalid` constructor.
 */
import { z } from "zod";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store behind the service reads its documents through `node:fs`, so this handler runs on the Node runtime and never on the edge runtime. */
export const runtime = "nodejs";

/**
 * Every request re-derives the session, the grant and the frozen cutoff, so no answer may survive a
 * revocation or the cutoff instant in a cache.
 */
export const dynamic = "force-dynamic";

/** A read carries no operation of its own, so an `invalid` outcome names the attempt this way. */
const READ_ATTEMPT_ID = "read";

/** The one portfolio view name, matched exactly: no other spelling or case names a read that exists. */
const PORTFOLIO_VIEW = "portfolio";

/** Parameters that would claim an identity; the coach is resolved from the session, so these carry no meaning here. */
const IDENTITY_PARAMETERS = ["coachId", "principalId", "persona", "actingAs", "subjectPrincipalId", "as"] as const;

const MESSAGES = {
  identity:
    "Choose the acting coach through the development session, not the query string: an identity named in the query would be a second and silent way to claim one while the session still decides which grants are read.",
  oneSelector: "Name one selector per request: `view=portfolio` reads the whole portfolio and `subjectId=<id>` reads one subject, so naming both leaves no single read to answer.",
  selectorRequired: "Name the read: `view=portfolio` for the coach's portfolio, or `subjectId=<id>` for one subject the coach holds a grant for.",
  subjectIdBlank: "Name the subject in `subjectId`: a blank value addresses no subject, and the read would have to guess which one was meant.",
  viewNotPortfolio: "Name the view as `portfolio`: it is the only view this read serves, and any other value names a read that does not exist.",
} as const;

/**
 * The selector grammar, as one schema over the search parameters. Every refusal is keyed by the
 * parameter that caused it, so the body names a field and never a subject, a count or a module.
 */
const coachQuerySchema = z
  .object({
    view: z.string().optional(),
    subjectId: z.string().optional(),
    // Admitted only so that a claimed identity is refused by name instead of being stripped unseen.
    coachId: z.string().optional(),
    principalId: z.string().optional(),
    persona: z.string().optional(),
    actingAs: z.string().optional(),
    subjectPrincipalId: z.string().optional(),
    as: z.string().optional(),
  })
  .superRefine((query, context) => {
    const claimedIdentities = IDENTITY_PARAMETERS.filter((name) => query[name] !== undefined);
    for (const name of claimedIdentities) {
      context.addIssue({ code: "custom", path: [name], message: MESSAGES.identity });
    }
    if (claimedIdentities.length > 0) {
      return;
    }
    const { subjectId, view } = query;
    if (view !== undefined && subjectId !== undefined) {
      context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.oneSelector });
      context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.oneSelector });
      return;
    }
    if (subjectId !== undefined) {
      // The value is opaque: it is forwarded exactly as it arrived, never parsed, coerced, split or
      // matched against a list. Only the blank case is refused, because it addresses no subject at all.
      if (subjectId.trim().length === 0) {
        context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.subjectIdBlank });
      }
      return;
    }
    if (view !== undefined) {
      if (view !== PORTFOLIO_VIEW) {
        context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.viewNotPortfolio });
      }
      return;
    }
    context.addIssue({ code: "custom", path: ["view"], message: MESSAGES.selectorRequired });
    context.addIssue({ code: "custom", path: ["subjectId"], message: MESSAGES.selectorRequired });
  });

/** Every search parameter as it arrived; the schema names the ones this read admits and strips the rest. */
function searchParametersOf(search: URLSearchParams): Record<string, string> {
  return Object.fromEntries(search);
}

/** Answers with one read envelope — the coach's portfolio, or one admitted subject's shared modules — or the read's own refusal. */
export async function GET(request: Request): Promise<Response> {
  const parsed = coachQuerySchema.safeParse(searchParametersOf(new URL(request.url).searchParams));
  if (!parsed.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, parsed.error));
  }
  const { subjectId } = parsed.data;
  try {
    // A named subject reads as itself; otherwise `view=portfolio` was validated and the portfolio read
    // runs. The read's arms travel untouched: `denied` and `unavailable` stay themselves rather than
    // becoming an empty portfolio or a zero, and a portfolio holding no admitted subject stays an
    // envelope whose `holdsNoSubjects` says so — which arm a call answers with belongs to the service,
    // and re-deciding it here would put a second owner on the states only that service judges.
    if (subjectId !== undefined) {
      return toResponse(await reads.coach.readCoachSubject({ grantId: subjectId }));
    }
    return toResponse(await reads.coach.readCoachPortfolio());
  } catch (error) {
    // A read answers its refusals as results, so a throw is a store or medium fault, or a failure whose
    // fate is not known: the one mapper decides which, and nothing escapes as an HTML 500.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
