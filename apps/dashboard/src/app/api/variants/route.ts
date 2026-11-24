import type { NextRequest } from "next/server";
import { z } from "zod";
import { VARIANT_AUDIENCES } from "@/modules/content/variant";
import { mutationInputSchema, mutations, reads, refusedRead, toResponse } from "@/modules/data-service";
import { invalid } from "@/modules/data-service/outcome";
import { writeRoute } from "../handler";
import { READ_ATTEMPT, readResponse } from "../read";
import { sessionIdOf } from "../session-cookie";
import { routeMethods } from "@/app/api/methods";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UPDATE_FAMILY = "update" as const;
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
const createVariantPayloadSchema = z.strictObject({ documentId: documentIdSchema, audience: z.enum(VARIANT_AUDIENCES, { error: MUTATION_MESSAGES.audienceInvalid }), locale: localeTagSchema });
const createVariantBodySchema = mutationInputSchema(createVariantPayloadSchema);
const variantQuerySchema = z.object({ view: z.enum(VARIANT_VIEWS, { error: MESSAGES.view }), variantId: z.string({ error: MESSAGES.variantId }).min(1, MESSAGES.variantId) });
function searchValueOf(search: URLSearchParams, name: string): string | readonly string[] | undefined {
  const values = search.getAll(name);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}
const queryOf = (search: URLSearchParams): Record<keyof z.output<typeof variantQuerySchema>, string | readonly string[] | undefined> => ({ view: searchValueOf(search, "view"), variantId: searchValueOf(search, "variantId") });
function readVariants(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const selecting = EDITION_SELECTING_PARAMETERS.find((name) => search.has(name));
  if (selecting !== undefined) return Promise.resolve(toResponse(invalid({ operationId: READ_ATTEMPT, fields: { [selecting]: [EDITION_SELECTION_REFUSED] } })));
  const parsed = variantQuerySchema.safeParse(queryOf(search));
  if (!parsed.success) return Promise.resolve(toResponse(refusedRead(READ_ATTEMPT, parsed.error)));
  const { view, variantId } = parsed.data;
  return readResponse(READ_ATTEMPT, () => (view === "release" ? reads.updates.readRelease({ variantId }) : reads.updates.readSharePresentation({ variantId })));
}
/** Creates one working edition of one Update — one family-permitted audience in one exact content locale, with no draft, candidate or release yet. */
const createVariant = (request: NextRequest): Promise<Response> => writeRoute(request, createVariantBodySchema, (input) => mutations.updates.createVariant(sessionIdOf(request), { ...input, payload: { ...input.payload, family: UPDATE_FAMILY } }));
export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routeMethods({ GET: readVariants, POST: createVariant });
