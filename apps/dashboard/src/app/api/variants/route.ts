/** The Updates family's edition transport: */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { VARIANT_AUDIENCES } from "@/modules/content/variant";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { sessionIdOf } from "../session-cookie";
import { jsonBodyOf, operationIdentityOf } from "../handler";
// The store behind the service writes through node:fs and both content reads resolve renditions from it, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// A release and a share presentation both move under the caller — a withdrawal, a restriction, a new head or a persona switch — so an answer is resolved per request and never cached.
export const dynamic = "force-dynamic";
/** The identity a read's refusal is reported under, so an envelope and a refusal answer alike. */
const READ_ATTEMPT_ID = "read";
const UPDATE_FAMILY = "update" as const;
// The two facts this path reads. A draft, a candidate and a preview are other paths' jobs: a third member here would put a second selection behind this route.
const VARIANT_VIEWS = ["release", "share"] as const;
const EDITION_SELECTING_PARAMETERS = ["audience", "locale"] as const;
const EDITION_SELECTION_REFUSED =
  "This read answers the edition variantId identifies, whose own audience and locale the envelope states, so a parameter of this name is refused rather than silently dropped: a caller whose filter was discarded would read one edition believing it had chosen another. State view and variantId only.";
const MESSAGES = { view: "State view as release or share: this path reads a released edition or its share presentation, and no other fact.", variantId: "State variantId once, as the opaque identity of one edition." } as const;
const MUTATION_MESSAGES = {
  documentRequired: "Name the Update this edition belongs to, by the identifier this application uses: open the Update again rather than pasting an address.",
  audienceInvalid: "Choose the audience this edition serves: public or approved supporters, and no other value.",
  localeRequired: "State the content locale this edition is written in, such as en, fr or ar-EG.",
  localeInvalid: "Use a content-locale tag such as en, fr or ar-EG: a language subtag, then any hyphen-separated subtags.",
} as const;
const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const documentIdSchema = z.string({ error: MUTATION_MESSAGES.documentRequired }).trim().min(1, MUTATION_MESSAGES.documentRequired).max(160, MUTATION_MESSAGES.documentRequired);
const localeTagSchema = z.string({ error: MUTATION_MESSAGES.localeRequired }).trim().min(2, MUTATION_MESSAGES.localeInvalid).max(35, MUTATION_MESSAGES.localeInvalid).regex(LOCALE_TAG_PATTERN, MUTATION_MESSAGES.localeInvalid);
// Shape only: which audience a family admits, and whether an audience-and-locale edition already exists, are the variant model's decisions behind the service, and they answer `invalid` with the field they refuse. Direction is derived from the tag there too, so it is not a caller input here.
// The two audiences are the content module's own tuple rather than a second copy of it, so a value the variant model adds reaches this boundary instead of being restated here.
const createVariantPayloadSchema = z.strictObject({ documentId: documentIdSchema, audience: z.enum(VARIANT_AUDIENCES, { error: MUTATION_MESSAGES.audienceInvalid }), locale: localeTagSchema });
const createVariantBodySchema = mutationInputSchema(createVariantPayloadSchema);
// The query grammar this path states. It is not strict: a cache-busting parameter or a trailing `?` must not turn an authorised read into a refusal, though a parameter the grammar does not name is never read, so it can reach no read field either. The audience and locale an edition serves are not
// part of it: a request that states either is refused by name before this grammar runs.
const variantQuerySchema = z.object({ view: z.enum(VARIANT_VIEWS, { error: MESSAGES.view }), variantId: z.string({ error: MESSAGES.variantId }).min(1, MESSAGES.variantId) });
type VariantQuery = z.output<typeof variantQuerySchema>;
function searchValueOf(search: URLSearchParams, name: string): string | readonly string[] | undefined {
  const values = search.getAll(name);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}
/** The grammar's input, built by name so a parameter the grammar does not state cannot reach a read. */
function queryOf(search: URLSearchParams): Record<keyof VariantQuery, string | readonly string[] | undefined> {
  return { view: searchValueOf(search, "view"), variantId: searchValueOf(search, "variantId") };
}
/** Refuses a stated `audience` or `locale` search parameter by name, before the grammar runs: the two reads identify an edition by `variantId`, so a filter of either name has nothing to select and … */
function editionSelectionRefusal(request: Request): Response | undefined {
  const search = new URL(request.url).searchParams;
  for (const name of EDITION_SELECTING_PARAMETERS) {
    if (!search.has(name)) continue;
    return toResponse(invalid({ operationId: READ_ATTEMPT_ID, fields: { [name]: [EDITION_SELECTION_REFUSED] } }));
  }
  return undefined;
}
/** The release standing at one edition's head, or the share presentation one edition shows, as the one read envelope. */
export async function GET(request: Request): Promise<Response> {
  const refused = editionSelectionRefusal(request);
  if (refused !== undefined) return refused;
  const parsed = variantQuerySchema.safeParse(queryOf(new URL(request.url).searchParams));
  if (!parsed.success) {
    // The `invalid` outcome with its per-field messages, rendered by the one response mapper: a caller that asked for a fact this path does not read is told which parameter carried the problem, and no read is performed.
    return toResponse(refusedRead(READ_ATTEMPT_ID, parsed.error));
  }
  const { view, variantId } = parsed.data;
  // `audience` and `locale` were refused above, by name, before this grammar ran: these two reads identify an edition by `variantId` alone and answer with that edition's own audience and locale, so there is no filter for either to reach. The envelope therefore states the edition actually
  // read rather than echoing the request back.
  try {
    switch (view) {
      case "release":
        return toResponse(await reads.updates.readRelease({ variantId }));
      case "share":
        return toResponse(await reads.updates.readSharePresentation({ variantId }));
      default:
        // Unreachable: the grammar admits exactly these two views, so a third read fails to compile at this call instead of reaching the runtime.
        return assertNever(view, "Unhandled variant view");
    }
  } catch (error) {
    // A throw is a defect rather than a presentation: the reads answer refusals as results, so a throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Creates one working edition of one Update — one family-permitted audience in one exact content locale, with no draft, candidate or release yet — and answers with exactly one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = operationIdentityOf(raw);
  const parsed = createVariantBodySchema.safeParse(raw);
  if (!parsed.success) {
    // The one response mapper renders the per-field messages, so a caller learns which field of the body was refused and no edition is created.
    return toResponse(outcomeFromError(operationId, parsed.error));
  }
  try {
    // The scope the caller states is forwarded as it stands: the service checks it against the session's admissions and re-checks the scope the edition lands in, so no authority is decided here. A replay of the same operationId answers `alreadyAccepted` with the edition already
    // created, so a lost acknowledgement recovers rather than creating a second one.
    return toResponse(await mutations.updates.createVariant(sessionIdOf(request), { ...parsed.data, payload: { ...parsed.data.payload, family: UPDATE_FAMILY } }));
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes, so this is a store fault, or a failure whose fate is not known. The caller keeps its operationId and re-queries it rather than sending the work again under a fresh one.
    return toResponse(outcomeFromError(operationId, error));
  }
}
