/**
 * `GET /api/variants` — the one release transport: the release standing at one edition's head, or the
 * share presentation a link shows. Reading only, so no publication, notification or withdrawal write
 * is reachable through this path.
 */
import { z } from "zod";
import { assertNever } from "@/lib/result";
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
// The store behind the service writes through node:fs and both content reads resolve renditions from
// it, so this handler never runs on the edge runtime.
export const runtime = "nodejs";
// A release and a share presentation both move under the caller — a withdrawal, a restriction, a new
// head or a persona switch — so an answer is resolved per request and never cached.
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

// The two facts this path reads. A draft, a candidate and a preview are other paths' jobs: a third
// member here would put a second selection behind this route.
const VARIANT_VIEWS = ["release", "share"] as const;

// The two audiences an Update variant can have. Whether a family admits a given audience and locale
// for a document is the service's answer, made behind the read this route calls.
const VARIANT_AUDIENCES = ["public", "approved-supporter"] as const;

const MESSAGES = {
  view: "State view as release or share: this path reads a released edition or its share presentation, and no other fact.",
  variantId: "State variantId once, as the opaque identity of one edition.",
  audience: "State audience as public or approved-supporter when you state it, and no other value.",
  locale: "State locale once, as one non-empty language tag.",
} as const;

// The query grammar this path states. It is not strict: a cache-busting parameter or a trailing `?`
// must not turn an authorised read into a refusal, though a parameter the grammar does not name is
// never read, so it can reach no read field either.
const variantQuerySchema = z.object({
  view: z.enum(VARIANT_VIEWS, { error: MESSAGES.view }),
  variantId: z.string({ error: MESSAGES.variantId }).min(1, MESSAGES.variantId),
  audience: z.enum(VARIANT_AUDIENCES, { error: MESSAGES.audience }).optional(),
  locale: z.string({ error: MESSAGES.locale }).min(1, MESSAGES.locale).optional(),
});

type VariantQuery = z.output<typeof variantQuerySchema>;

/**
 * One search parameter as the URL carries it. A parameter stated twice arrives as an array, which the
 * grammar refuses rather than reading the first value and answering half of what was asked.
 */
function searchValueOf(search: URLSearchParams, name: string): string | readonly string[] | undefined {
  const values = search.getAll(name);
  if (values.length === 0) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}

/** The grammar's input, built by name so a parameter the grammar does not state cannot reach a read. */
function queryOf(search: URLSearchParams): Record<keyof VariantQuery, string | readonly string[] | undefined> {
  return {
    view: searchValueOf(search, "view"),
    variantId: searchValueOf(search, "variantId"),
    audience: searchValueOf(search, "audience"),
    locale: searchValueOf(search, "locale"),
  };
}

/** The release standing at one edition's head, or the share presentation one edition shows, as the one read envelope. */
export async function GET(request: Request): Promise<Response> {
  const parsed = variantQuerySchema.safeParse(queryOf(new URL(request.url).searchParams));
  if (!parsed.success) {
    // The `invalid` outcome with its per-field messages, rendered by the one response mapper: a caller
    // that asked for a fact this path does not read is told which parameter carried the problem, and
    // no read is performed.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, parsed.error));
  }
  const { view, variantId } = parsed.data;
  // `audience` and `locale` are stated by the grammar so a value outside the two audiences, or an
  // empty tag, is refused rather than quietly accepted, but neither is forwarded: these two reads
  // identify an edition by `variantId` alone and answer with that edition's own audience and locale,
  // so there is no filter for either to reach. The envelope therefore states the edition actually
  // read rather than echoing the request back.
  try {
    switch (view) {
      case "release":
        return toResponse(await reads.updates.readRelease({ variantId }));
      case "share":
        return toResponse(await reads.updates.readSharePresentation({ variantId }));
      default:
        // Unreachable: the grammar admits exactly these two views, so a third read fails to compile at
        // this call instead of reaching the runtime.
        return assertNever(view, "Unhandled variant view");
    }
  } catch (error) {
    // A throw is a defect rather than a presentation: the reads answer refusals as results, so a throw
    // means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
