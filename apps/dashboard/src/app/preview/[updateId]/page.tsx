/** `/preview/[updateId]` — the exact-post receiving view of one released Update (AAP 0.9.1, 0.6.4). **What this file is.** Composition, nothing else: it reads the one exact-post read in the language the address asks for and hands that answer, unchanged, to the surface that renders it. */

import type { Metadata } from "next";
import type { ReactElement } from "react";

import { ReceivingPost } from "@/features/audience/components/receiving-post";
import { reads, type Scope } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// The read's own shape, taken from the service rather than restated
// ---------------------------------------------------------------------------------------------

/** What the development runtime answers about the seeded persona this session is previewing as. */
type DevelopmentRead = Awaited<ReturnType<typeof reads.dev.readDevState>>;

/** The URL's own parameter record, as Next 16 hands a route its search parameters. */
type SearchParams = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/**
 * The read re-authorises this session against the exact edition on every request, so a switched
 * persona, a restriction or a withdrawal is answered by the same read instead of a cached one.
 */
export const dynamic = "force-dynamic";

/**
 * The title names the surface and no record: metadata renders even where the read refuses, so a
 * record-derived title would leak a title or an existence hint to a caller the read turns away.
 */
export const metadata: Metadata = { title: "Receiving preview" };

/** The one search parameter this route reads: the language the address asks the edition to be served in. */
const LOCALE_PARAM = "locale";

/**
 * The longest language tag this route forwards. RFC 5646 caps a language tag at 35 characters, so a longer
 * value cannot name any released edition: it is treated as no request at all rather than handed to the read,
 * which keeps an address from making the read carry a string no edition could ever match.
 */
const MAX_LOCALE_TAG_LENGTH = 35;

/**
 * The authority stated when the read refuses or reports an outage — none at all, which is the same
 * no-authority scope the root layout names for that case. The reading surface renders the refusal or
 * the outage from the returned answer, so nothing here claims an access the service never stated.
 */
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };

/** The reader stated when the development runtime cannot name this session's seeded persona, so the surface still says whose access was checked. */
const UNNAMED_PERSONA = "this session's admitted reader";

// ---------------------------------------------------------------------------------------------
// What the two answers name
// ---------------------------------------------------------------------------------------------

/** The seeded persona's own label, or `undefined` when the development runtime names none. */
function personaLabelOf(development: DevelopmentRead): string | undefined {
  if (development.kind !== "envelope") {
    return undefined;
  }
  const { activePersonaId, personaCatalogue } = development.envelope.data;
  if (activePersonaId === null) {
    return undefined;
  }
  return personaCatalogue.personas.find((persona) => persona.id === activePersonaId)?.label;
}

// ---------------------------------------------------------------------------------------------
// The language the address asks for
// ---------------------------------------------------------------------------------------------

/**
 * The language the address asks this edition to be served in, or nothing when it asks for none.
 *
 * Exactly one value is read, because a parameter repeated in the address names no single language and is
 * ignored rather than resolved here. The value is trimmed, since an address may carry padding around it, and
 * a value that is empty, or longer than any language tag can be, is treated as no request at all. What
 * survives is forwarded as the reader's request and nothing more: the read is the only place that knows which
 * editions this reader is admitted to, whether serving one was a fallback, and whether the honest answer is
 * that no released edition is in the language asked for.
 */
function requestedLocaleFrom(searchParams: SearchParams): string | undefined {
  const stated = searchParams[LOCALE_PARAM];
  if (typeof stated !== "string") return undefined;
  const trimmed = stated.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOCALE_TAG_LENGTH) return undefined;
  return trimmed;
}

// ---------------------------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------------------------

/** One published Update at its exact post, in the language the address asks for, exactly as this reader's access admits it right now. */
export default async function ReceivingPostPage({ params, searchParams }: { params: Promise<{ updateId: string }>; searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  // Next 16 hands a dynamic segment's parameters and the address's search parameters as promises. The address
  // may name the language this reader asks for, and that request is forwarded unchanged apart from the
  // normalising above; the session, the released edition, the fallback and the served language are still
  // resolved inside the read, which is the only place that knows what this reader may open. An address that
  // names no language asks for none, and the read answers with this reader's own preference as it always has.
  const [{ updateId }, stated] = await Promise.all([params, searchParams]);
  const locale = requestedLocaleFrom(stated);
  // Neither answer depends on the other, so both are read together: the post read authorises this reader
  // against the exact edition in the language asked for, and the development read names the persona the
  // preview is opened as.
  const [post, development] = await Promise.all([reads.audience.readReceivingPost({ updateId, locale }), reads.dev.readDevState()]);
  // The edition is read in the authority the read itself stated; a refusal or an outage states none.
  const scope = post.kind === "envelope" ? post.envelope.scope : NO_AUTHORITY_SCOPE;
  // The surface renders its own section and the page's one heading from the answer, so this route adds no
  // second heading and no heading string of its own: a denial, a withdrawal and a language no released edition
  // admits each arrive as data and are rendered as that answer — the surface's own *Language unavailable* for
  // the last of them — rather than as an empty edition.
  return <ReceivingPost scope={scope} params={{ updateId, locale }} initialEnvelope={post} persona={personaLabelOf(development) ?? UNNAMED_PERSONA} />;
}
