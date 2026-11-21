/**
 * `GET /api/initiatives` — one page of this ministry's initiatives — and `POST /api/initiatives`, the
 * one creation this path performs.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
// The store behind the service writes through `node:fs`, so this handler never runs on the edge.
export const runtime = "nodejs";
// Both verbs resolve the development session and evaluate the scenario clock once per request.
export const dynamic = "force-dynamic";

type InitiativeListQuery = NonNullable<Parameters<typeof reads.outreach.readInitiatives>[0]>;

type InitiativeStateName = NonNullable<InitiativeListQuery["state"]>;

type InitiativeSortName = NonNullable<InitiativeListQuery["sort"]>;

const READ_ATTEMPT_ID = "read";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
// The closed vocabularies the list read admits, stated from its own query type so no wire value is
// ever asserted into it.
const INITIATIVE_STATES = ["open", "closed"] as const satisfies readonly InitiativeStateName[];

const INITIATIVE_SORTS = ["name", "period-start", "state"] as const satisfies readonly InitiativeSortName[];

function nonBlank(message: string): z.ZodString {
  // Trimming is tested here rather than stated as `.trim().min(1)`, so a value of blanks is refused
  // whatever order the schema applies its transformations in.
  return z.string().refine((value) => value.trim().length > 0, message);
}
// The keys a creation admits, and nothing else: the ministry and organisation come from the request's
// scope, the state and revision belong to the record, and the person responsible is named by an opaque
// principal reference. The loose object is what lets the refusal below name the offending field by its
// own path; bounds, calendar validity and identity remain `createInitiative`'s own to judge, so only
// shape and non-emptiness are stated here. The period carries the two ends under the names the
// service's own schema reads — `startOn` and `endOn` — as civil dates exactly as they arrived: no
// instant, no display zone and no fabricated midnight.
const ADMITTED_PAYLOAD_KEYS = ["name", "purpose", "responsiblePrincipalId", "period"] as const;

const createInitiativePayloadSchema = z
  .looseObject({
    name: nonBlank("Give the initiative a name."),
    purpose: nonBlank("Describe what this initiative is for."),
    responsiblePrincipalId: nonBlank("Choose the person responsible for this initiative.").optional(),
    period: z.strictObject({ startOn: nonBlank("State the first day of the period."), endOn: nonBlank("State the last day of the period.") }).optional(),
  })
  .superRefine((value, context) => {
    for (const key of Object.keys(value)) {
      if (ADMITTED_PAYLOAD_KEYS.some((admitted) => admitted === key)) {
        continue;
      }
      context.addIssue({
        code: "custom",
        path: [key],
        message:
          "An initiative is created from a name, a purpose, the person responsible and an optional period: the ministry and organisation come from the acting context, and no field of a change may name them.",
      });
    }
  });

const createInitiativeRequestSchema = mutationInputSchema(createInitiativePayloadSchema);

function isInitiativeState(value: string | null): value is InitiativeStateName {
  return value !== null && INITIATIVE_STATES.some((admitted) => admitted === value);
}
function isInitiativeSort(value: string | null): value is InitiativeSortName {
  return value !== null && INITIATIVE_SORTS.some((admitted) => admitted === value);
}
function initiativeListQueryOf(request: Request): InitiativeListQuery {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const search = params.get("search");
  const sort = params.get("sort");
  const page = params.get("page");
  const pageSize = params.get("pageSize");
  // The query is forwarded, not judged: a state or order this read does not admit is left out rather
  // than refused or asserted into its types, and the read owns which values exist, the page bounds and
  // every count, so an unrecognised parameter never fails the request here.
  return {
    ...(isInitiativeState(state) ? { state } : {}),
    ...(search === null ? {} : { search }),
    ...(isInitiativeSort(sort) ? { sort } : {}),
    ...(page === null ? {} : { page: Number(page) }),
    ...(pageSize === null ? {} : { pageSize: Number(pageSize) }),
  };
}
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  // Read rather than asserted: a body that failed validation is still the attempt a caller must be
  // able to recognise, and its claim is echoed only when it is a non-empty string.
  const claimed: unknown = Reflect.get(body, "operationId");
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** One page of initiatives, exactly as the request asked for it: the read's envelope, or the read's own `denied` or `unavailable` refusal. */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.outreach.readInitiatives(initiativeListQueryOf(request)));
  } catch (error) {
    // One mapper knows a store outage, a session that cannot be established and a lost
    // acknowledgement apart, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one initiative in the ministry this session is acting in. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = createInitiativeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.outreach.createInitiative(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
