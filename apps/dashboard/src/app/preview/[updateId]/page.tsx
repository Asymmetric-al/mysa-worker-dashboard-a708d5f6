import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ReceivingPost } from "@/features/audience/components/receiving-post";
import { reads, type Scope } from "@/modules/data-service";
type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reader preview" };
const MAX_LOCALE_TAG_LENGTH = 35;
// A variant identity is one opaque reference naming a document, an audience and a language tag, so a stated value longer than this cannot name an edition of this application.
const MAX_VARIANT_REFERENCE_LENGTH = 200;
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
function personaLabelOf(development: Awaited<ReturnType<typeof reads.dev.readDevState>>): string | undefined {
  if (development.kind !== "envelope") return undefined;
  const { activePersonaId, personaCatalogue } = development.envelope.data;
  if (activePersonaId === null) return undefined;
  return personaCatalogue.personas.find((persona) => persona.id === activePersonaId)?.label;
}
function requestedLocaleFrom(searchParams: SearchParams): string | undefined {
  const stated = searchParams["locale"];
  if (typeof stated !== "string") return undefined;
  const trimmed = stated.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOCALE_TAG_LENGTH) return undefined;
  return trimmed;
}
function requestedVariantFrom(searchParams: SearchParams): string | undefined {
  const stated = searchParams["variant"];
  if (typeof stated !== "string") return undefined;
  const trimmed = stated.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VARIANT_REFERENCE_LENGTH) return undefined;
  return trimmed;
}
/** One published Update at its exact post, in the edition the address pins and the language it asks for, exactly as this reader's access admits it right now. */
export default async function ReceivingPostPage({ params, searchParams }: { params: Promise<{ updateId: string }>; searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const [{ updateId }, stated] = await Promise.all([params, searchParams]);
  const locale = requestedLocaleFrom(stated);
  const variant = requestedVariantFrom(stated);
  const [post, development] = await Promise.all([reads.audience.readReceivingPost({ updateId, locale, variant }), reads.dev.readDevState()]);
  const scope = post.kind === "envelope" ? post.envelope.scope : NO_AUTHORITY_SCOPE;
  return <ReceivingPost scope={scope} params={{ updateId, locale, variant }} initialEnvelope={post} persona={personaLabelOf(development) ?? "your current session"} />;
}
