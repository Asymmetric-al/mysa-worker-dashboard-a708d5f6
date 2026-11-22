/**
 * `/preview` — the receiving list: the released Updates the session's currently admitted preview persona
 * may open right now, exactly as the service authorised them.
 *
 * **Two reads, and neither is about permission that arrives in a URL.** `readReceivingList` answers the
 * list itself, and `readDevState` answers the one fact the list has to state in words — which seeded
 * persona this is — because the persona is resolved from the development-session cookie by the service
 * and never named in the address, a header or a body. Both answers are used as the service gave them:
 * the list result travels into the component unchanged, so a denial, an outage, a refused request and
 * an empty list stay four different renderings, and a persona that may read nothing is shown its denial
 * rather than a list that was narrowed here.
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ReceivingList, type ReceivingListProps, type ReceivingPersonaView } from "@/features/audience/components/receiving-list";
import { assertNever } from "@/lib/result";
import { reads, type Scope } from "@/modules/data-service";
// The two reads' own shapes, taken from the reads rather than restated
type ReceivingListResult = Awaited<ReturnType<typeof reads.audience.readReceivingList>>;
type DevelopmentResult = Awaited<ReturnType<typeof reads.dev.readDevState>>;
/** The query this route forwards: the language asked for and the paging window, as the receiving list declares them. */
type ReceivingQuery = NonNullable<ReceivingListProps["params"]>;
// Fixed values
/** The surface's own name, which also labels its navigation entry, so the shell and this page agree about what the route is. */
const SURFACE_TITLE = "Receiving preview";
/**
 * Both reads answer from this session's cookie and a restored seed or a persona switch changes what they
 * answer, so the route is rendered per request: a list cached across a switch could serve one persona's
 * editions to another.
 */
export const dynamic = "force-dynamic";
// Metadata renders even when the body refuses the read, so the title is static and names no record: a
// record-derived title would disclose a title, a count or an existence hint to a caller that was denied.
export const metadata: Metadata = { title: SURFACE_TITLE };
const HEADING_ID = "receiving-preview-heading";
const WRAPPER_CLASS = "flex min-w-0 flex-col gap-6 text-start";
const H1_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";
/** The interface locale the composed surface formats its counts in. The reading language the list serves is a separate value and travels in the address. */
const INTERFACE_LOCALE = "en-GB";
const LOCALE_PARAM = "locale";
const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";
/** The authority a refused read carries: a denial states no scope, and none may be invented in its place. */
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
/**
 * What the list says when no seeded persona could be read — the address named none, and a catalogue that
 * could not be read names no one either. It states the session rather than inventing a person.
 */
const UNNAMED_PERSONA: ReceivingPersonaView = { id: "", label: "the session this page is being read in" };
// Reading each answer
/**
 * The authority the list was read under, stated by the envelope itself. A denial carries no scope, so the
 * route states the absence of authority rather than presenting a scope the service never granted.
 */
function scopeOf(result: ReceivingListResult): Scope {
  return result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
}
/** The seeded persona this session's principal is, named from the development runtime's own catalogue. */
function personaOf(result: DevelopmentResult): ReceivingPersonaView {
  switch (result.kind) {
    case "envelope": {
      const { activePersonaId, personaCatalogue } = result.envelope.data;
      const active = personaCatalogue.personas.find((persona) => persona.id === activePersonaId);
      return active === undefined ? UNNAMED_PERSONA : { id: active.id, label: active.label };
    }
    case "denied":
    case "unavailable":
    case "refused":
      return UNNAMED_PERSONA;
    default:
      return assertNever(result, "Unhandled development read result");
  }
}
/** The one value of an address parameter, so a parameter repeated in the address is not read as several. */
function singleValueOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
/**
 * A number as the address states it. The read is the only place a page number is interpreted and clamped,
 * so text that is not a number is forwarded as "not stated" instead of being corrected into a page here.
 */
function countOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
/** The query the address states: the content language and the paging window, with an unstated member omitted rather than defaulted here. */
function queryOf(searchParams: Record<string, string | string[] | undefined>): ReceivingQuery {
  const locale = (singleValueOf(searchParams[LOCALE_PARAM]) ?? "").trim();
  const page = countOf(singleValueOf(searchParams[PAGE_PARAM]));
  const pageSize = countOf(singleValueOf(searchParams[PAGE_SIZE_PARAM]));
  return { ...(locale === "" ? {} : { locale }), ...(page === undefined ? {} : { page }), ...(pageSize === undefined ? {} : { pageSize }) };
}
// The route
/** What this route receives: the content language and paging window the receiving list itself writes, all unresolved. */
export interface ReceivingPreviewPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}
/** The Updates receiving list for the selected persona. */
export default async function ReceivingPreviewPage({ searchParams }: ReceivingPreviewPageProps): Promise<ReactElement> {
  const query = queryOf(await searchParams);
  // Both answers describe the same request and neither depends on the other, so they are read together rather than one after the other.
  const [result, development] = await Promise.all([reads.audience.readReceivingList(query), reads.dev.readDevState()]);
  return (
    <section aria-labelledby={HEADING_ID} className={WRAPPER_CLASS}>
      {/* The one h1 on this route: the receiving list continues below it at level two. */}
      <h1 id={HEADING_ID} className={H1_CLASS}>
        {SURFACE_TITLE}
      </h1>
      <ReceivingList scope={scopeOf(result)} locale={INTERFACE_LOCALE} initialEnvelope={result} persona={personaOf(development)} params={query} />
    </section>
  );
}
