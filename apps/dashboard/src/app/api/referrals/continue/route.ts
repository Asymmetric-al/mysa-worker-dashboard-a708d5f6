/**
 * `POST /api/referrals/continue` — the one way a browser continues an ordinarily expired referral
 * cycle, answering exactly one of the service's eight outcomes: `accepted`, `alreadyAccepted`,
 * `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`.
 */
import { z } from "zod";
import { logger } from "@/lib/logger";
import { isOutcome, mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationOutcome } from "@/modules/data-service";
/** The store behind the service writes its documents through `node:fs`, so this handler runs on the Node runtime and never on the edge runtime. */
export const runtime = "nodejs";
/** The change resolves the development session and reads the scenario instant once per request, so no answer this route produces may be cached. */
export const dynamic = "force-dynamic";
// `POST` is the only method this module defines, and that absence is the safeguard: a link preview, a
// mail scanner or a plain page load cannot consume a cycle, because Next answers every other method
// with 405 for the route it never exported.

const MESSAGES = {
  referralRequired: "This change is missing the referral it belongs to, so reload the referral and try again.",
  referralTooLong: "A referral reference is at most 200 characters.",
  bodyUnreadable: "Send this change as a JSON object carrying operationId, scope, expectedRevision and payload, so it can be read before anything changes.",
  foreignKey: (key: string): string =>
    `A continuation names only the expired referral cycle, so "${key}" has no part in it: the end of a continuation is computed from the instant it is accepted, and the change records no consent, no notification and no task.`,
} as const;

/** The one key a continuation carries: the cycle whose expiry it answers. */
const CONTINUE_REFERRAL_KEYS: readonly string[] = ["referralId"];

const MAX_REFERENCE_LENGTH = 200;

const MAX_OPERATION_ID_LENGTH = 64;

const MAX_SCOPE_ID_LENGTH = 128;

/** The identity a request that states no readable attempt is logged under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/** The authority a request that states no readable scope is logged under. */
const UNSTATED_SCOPE_ID = "unidentified-scope";

// The payload: one consumed cycle, and nothing that could change what a continuation means.
//
// The key set is closed, not merely typed. Every other key — a deadline, a duration, a window kind, a
// policy, a consent, a notification, a task, a recipient — describes something a continuation never
// decides, so each is refused against the key that carried it rather than being stripped and silently
// agreed to. Keeping the unknown keys visible is what lets the refusal name the field a form must fix.
const continueReferralPayloadSchema = z
  .looseObject({
    referralId: z.string({ error: MESSAGES.referralRequired }).trim().min(1, MESSAGES.referralRequired).max(MAX_REFERENCE_LENGTH, MESSAGES.referralTooLong),
  })
  .superRefine((payload, context) => {
    for (const key of Object.keys(payload)) {
      if (!CONTINUE_REFERRAL_KEYS.includes(key)) {
        context.addIssue({ code: "custom", path: [key], message: MESSAGES.foreignKey(key) });
      }
    }
  });
/** The whole body this route reads: the four-field mutation input wrapped around the continue payload. */
const continueReferralRequestSchema = mutationInputSchema(continueReferralPayloadSchema);

// The diagnostic line names the attempt and the authority the body claims. A body that states neither
// is still one request and one line: these markers say that nobody claimed them, rather than the line
// inventing an identifier or the request going unreported.
const claimedAttemptSchema = z.object({ operationId: z.string().min(1).max(MAX_OPERATION_ID_LENGTH) });

const claimedScopeIdSchema = z.string().min(1).max(MAX_SCOPE_ID_LENGTH);

const claimedScopeSchema = z.object({
  scope: z.object({
    organizationId: claimedScopeIdSchema,
    ministryId: claimedScopeIdSchema,
    supportSubjectId: claimedScopeIdSchema,
    principalId: claimedScopeIdSchema,
  }),
});

type LoggedScope = {
  readonly organizationId: string;
  readonly ministryId: string;
  readonly supportSubjectId: string;
  readonly principalId: string;
};

type RequestDiagnostic = {
  readonly operationId: string;
  readonly scope: LoggedScope;
  readonly startedAt: number;
};

const UNSTATED_SCOPE: LoggedScope = {
  organizationId: UNSTATED_SCOPE_ID,
  ministryId: UNSTATED_SCOPE_ID,
  supportSubjectId: UNSTATED_SCOPE_ID,
  principalId: UNSTATED_SCOPE_ID,
};

type BodyRead = { readonly state: "read"; readonly value: unknown } | { readonly state: "unreadable" };

async function readBody(request: Request): Promise<BodyRead> {
  try {
    const value: unknown = await request.json();
    return { state: "read", value };
  } catch {
    // A parse fault quotes the text it rejected, which may carry the referral's identity, so the
    // refusal is worded here instead of echoing it.
    return { state: "unreadable" };
  }
}

function attemptIdOf(body: unknown): string {
  const claimed = claimedAttemptSchema.safeParse(body);
  return claimed.success ? claimed.data.operationId : UNIDENTIFIED_ATTEMPT;
}

function loggedScopeOf(body: unknown): LoggedScope {
  const claimed = claimedScopeSchema.safeParse(body);
  return claimed.success ? claimed.data.scope : UNSTATED_SCOPE;
}

/** The refusal a body that is not readable JSON earns: a schema fault against the field the caller fills. */
function unreadableBodyRefusal(operationId: string): MutationOutcome {
  return outcomeFromError(operationId, new z.ZodError([{ code: "custom", path: ["body"], message: MESSAGES.bodyUnreadable }]));
}

/**
 * Answers whatever the work produced, after the one diagnostic line this request writes: exactly one
 * of the eight outcomes reaches the shared ladder, and a value that is not one of them is answered as
 * `unknown` so the caller re-queries the operation identity instead of a fault escaping as a 500.
 */
function answer(answered: unknown, diagnostic: RequestDiagnostic): Response {
  const outcome: MutationOutcome = isOutcome(answered) ? answered : outcomeFromError(diagnostic.operationId, answered);
  logger.mutation({
    operationId: diagnostic.operationId,
    scope: diagnostic.scope,
    outcome: outcome.outcome,
    elapsedMs: Math.round(performance.now() - diagnostic.startedAt),
  });
  return toResponse(outcome);
}

/** Continues one ordinarily expired referral cycle and answers `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const body = await readBody(request);
  const claimed = body.state === "read" ? body.value : undefined;
  const diagnostic: RequestDiagnostic = { operationId: attemptIdOf(claimed), scope: loggedScopeOf(claimed), startedAt };
  if (body.state === "unreadable") {
    return answer(unreadableBodyRefusal(diagnostic.operationId), diagnostic);
  }
  const parsed = continueReferralRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return answer(outcomeFromError(diagnostic.operationId, parsed.error), diagnostic);
  }
  try {
    // The one named change. Nothing here asks whether the cycle is ordinarily expired, whether the
    // caller still holds it, whether a continuation policy exists or whether worker continuation is
    // switched on, and nothing here retries or reserves the successor: those are the service's
    // answers, and a racing second Continue has to reach it to come back `unchanged` or `conflict`.
    return answer(await mutations.referrals.continueReferral(parsed.data), diagnostic);
  } catch (error) {
    // A throw is a defect rather than a presentation: the mutation answers refusals as outcomes, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return answer(outcomeFromError(diagnostic.operationId, error), diagnostic);
  }
}
