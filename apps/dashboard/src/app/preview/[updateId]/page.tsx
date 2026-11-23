import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ReceivingPost } from "@/features/audience/components/receiving-post";
import { reads, type Scope } from "@/modules/data-service";
type DevelopmentRead = Awaited<ReturnType<typeof reads.dev.readDevState>>;
type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receiving preview" };
const LOCALE_PARAM = "locale";
const MAX_LOCALE_TAG_LENGTH = 35;
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
const UNNAMED_PERSONA = "this session's admitted reader";
function personaLabelOf(development: DevelopmentRead): string | undefined {
  if (development.kind !== "envelope") return undefined;
  const { activePersonaId, personaCatalogue } = development.envelope.data;
  if (activePersonaId === null) return undefined;
  return personaCatalogue.personas.find((persona) => persona.id === activePersonaId)?.label;
}
function requestedLocaleFrom(searchParams: SearchParams): string | undefined {
  const stated = searchParams[LOCALE_PARAM];
  if (typeof stated !== "string") return undefined;
  const trimmed = stated.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOCALE_TAG_LENGTH) return undefined;
  return trimmed;
}
/** One published Update at its exact post, in the language the address asks for, exactly as this reader's access admits it right now. */
export default async function ReceivingPostPage({ params, searchParams }: { params: Promise<{ updateId: string }>; searchParams: Promise<SearchParams> }): Promise<ReactElement> {
  const [{ updateId }, stated] = await Promise.all([params, searchParams]);
  const locale = requestedLocaleFrom(stated);
  const [post, development] = await Promise.all([reads.audience.readReceivingPost({ updateId, locale }), reads.dev.readDevState()]);
  const scope = post.kind === "envelope" ? post.envelope.scope : NO_AUTHORITY_SCOPE;
  return <ReceivingPost scope={scope} params={{ updateId, locale }} initialEnvelope={post} persona={personaLabelOf(development) ?? UNNAMED_PERSONA} />;
}
