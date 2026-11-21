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

type CreateInitiativePayload = Parameters<typeof mutations.outreach.createInitiative>[0]["payload"];

const READ_ATTEMPT_ID = "read";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const createInitiativeRequestSchema = mutationInputSchema(z.custom<CreateInitiativePayload>());

function initiativeListQueryOf(request: Request): InitiativeListQuery {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const search = params.get("search");
  const sort = params.get("sort");
  const page = params.get("page");
  const pageSize = params.get("pageSize");
  return {
    ...(state === null ? {} : { state: state as InitiativeStateName }),
    ...(search === null ? {} : { search }),
    ...(sort === null ? {} : { sort: sort as InitiativeSortName }),
    ...(page === null ? {} : { page: Number(page) }),
    ...(pageSize === null ? {} : { pageSize: Number(pageSize) }),
  };
}
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** One page of initiatives, exactly as the request asked for it. */
export async function GET(request: Request): Promise<Response> {
  try {
    return toResponse(await reads.outreach.readInitiatives(initiativeListQueryOf(request)));
  } catch (error) {
    // One mapper knows a store outage, a session that cannot be established and a lost
    // acknowledgement apart, so a thrown fault is answered rather than escaping the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one initiative in the ministry this session is acting in. */
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
