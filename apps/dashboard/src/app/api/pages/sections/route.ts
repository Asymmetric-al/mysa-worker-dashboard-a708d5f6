/**
 * `POST /api/pages/sections` — the six writes that compose one page draft's section list:
 * `addSection`, `moveSection`, `duplicateSection`, `removeSection`, `saveSectionFields` and
 * `applyPreset`, chosen by `payload.operation`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { mutationInputSchema, mutations, outcomeFromError, toResponse, type MutationInput, type MutationOutcome } from "@/modules/data-service";
import { sessionIdOf } from "../../session-cookie";
// The store writes through node:fs, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// Every mutation resolves the development session and the scenario clock per request.
export const dynamic = "force-dynamic";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";
const MESSAGES = {
  operationRequired: "State which change this request makes as payload.operation: addSection, moveSection, duplicateSection, removeSection, saveSectionFields or applyPreset.",
  bodyNotJson: "Send the change as a JSON object carrying operationId, scope, expectedRevision and payload.",
} as const;
type AddSectionPayload = Parameters<typeof mutations.pages.addSection>[1]["payload"];

type MoveSectionPayload = Parameters<typeof mutations.pages.moveSection>[1]["payload"];

type DuplicateSectionPayload = Parameters<typeof mutations.pages.duplicateSection>[1]["payload"];

type RemoveSectionPayload = Parameters<typeof mutations.pages.removeSection>[1]["payload"];

type SaveSectionFieldsPayload = Parameters<typeof mutations.pages.saveSectionFields>[1]["payload"];

type ApplyPresetPayload = Parameters<typeof mutations.pages.applyPreset>[1]["payload"];

type Routed<P> = P & { readonly operation: string };

const addSectionBodySchema = mutationInputSchema(z.custom<Routed<AddSectionPayload>>());
const moveSectionBodySchema = mutationInputSchema(z.custom<Routed<MoveSectionPayload>>());
const duplicateSectionBodySchema = mutationInputSchema(z.custom<Routed<DuplicateSectionPayload>>());
const removeSectionBodySchema = mutationInputSchema(z.custom<Routed<RemoveSectionPayload>>());
const saveSectionFieldsBodySchema = mutationInputSchema(z.custom<Routed<SaveSectionFieldsPayload>>());
const applyPresetBodySchema = mutationInputSchema(z.custom<Routed<ApplyPresetPayload>>());

const SECTION_OPERATIONS = ["addSection", "moveSection", "duplicateSection", "removeSection", "saveSectionFields", "applyPreset"] as const;

const attemptIdentitySchema = z.object({ operationId: z.string() });

const discriminantSchema = z.object(
  {
    payload: z.object({ operation: z.enum(SECTION_OPERATIONS, { error: MESSAGES.operationRequired }) }, { error: MESSAGES.operationRequired }),
  },
  { error: MESSAGES.bodyNotJson },
);
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}
function operationIdentityOf(raw: unknown): string {
  const identity = attemptIdentitySchema.safeParse(raw);
  return identity.success && identity.data.operationId.length > 0 ? identity.data.operationId : UNIDENTIFIED_ATTEMPT;
}
function payloadOf<T extends { readonly operation: string }>(payload: T): Omit<T, "operation"> {
  const { operation: _discriminant, ...forwarded } = payload;
  return forwarded;
}
async function dispatch<P extends { readonly operation: string }>(
  schema: z.ZodType<MutationInput<P>>,
  raw: unknown,
  operationId: string,
  run: (input: MutationInput<Omit<P, "operation">>) => Promise<MutationOutcome>,
): Promise<Response> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    return toResponse(await run({ ...parsed.data, payload: payloadOf(parsed.data.payload) }));
  } catch (error) {
    // An exception here is a defect rather than a presentation: the service answers refusals as
    // outcomes, so a throw means a store fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(operationId, error));
  }
}
/** One named section mutation, selected by `payload.operation`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const sessionId = sessionIdOf(request);
  const claimed = discriminantSchema.safeParse(raw);
  if (!claimed.success) {
    return toResponse(outcomeFromError(operationId, claimed.error));
  }
  switch (claimed.data.payload.operation) {
    case "addSection":
      return dispatch(addSectionBodySchema, raw, operationId, (input) => mutations.pages.addSection(sessionId, input));
    case "moveSection":
      return dispatch(moveSectionBodySchema, raw, operationId, (input) => mutations.pages.moveSection(sessionId, input));
    case "duplicateSection":
      return dispatch(duplicateSectionBodySchema, raw, operationId, (input) => mutations.pages.duplicateSection(sessionId, input));
    case "removeSection":
      return dispatch(removeSectionBodySchema, raw, operationId, (input) => mutations.pages.removeSection(sessionId, input));
    case "saveSectionFields":
      return dispatch(saveSectionFieldsBodySchema, raw, operationId, (input) => mutations.pages.saveSectionFields(sessionId, input));
    case "applyPreset":
      return dispatch(applyPresetBodySchema, raw, operationId, (input) => mutations.pages.applyPreset(sessionId, input));
    default:
      // Unreachable: the six names above are the closed set the discriminant schema admits, so a seventh
      // mutation fails to compile at this call instead of reaching the runtime.
      return assertNever(claimed.data.payload.operation, "Unhandled page section mutation");
  }
}
