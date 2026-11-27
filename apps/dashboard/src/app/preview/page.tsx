import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ReceivingList, type ReceivingListProps, type ReceivingPersonaView } from "@/features/audience/components/receiving-list";
import { reads, type Scope } from "@/modules/data-service";
import { PageSurface } from "../page-frame";
const SURFACE_TITLE = "Reader preview";
/** The interface locale the composed surface formats its counts in. The reading language the list serves is a separate value and travels in the address. */ export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: SURFACE_TITLE };
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
const UNNAMED_PERSONA: ReceivingPersonaView = { id: "", label: "your current session" };
function personaOf(result: Awaited<ReturnType<typeof reads.dev.readDevState>>): ReceivingPersonaView {
  if (result.kind !== "envelope") return UNNAMED_PERSONA;
  const { activePersonaId, personaCatalogue } = result.envelope.data;
  const active = personaCatalogue.personas.find((persona) => persona.id === activePersonaId);
  return active === undefined ? UNNAMED_PERSONA : { id: active.id, label: active.label };
}
function queryOf(searchParams: Record<string, string | string[] | undefined>): NonNullable<ReceivingListProps["params"]> {
  const single = (name: string): string | undefined => {
    const value = searchParams[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const count = (name: string): number | undefined => {
    const stated = single(name);
    const parsed = stated === undefined ? Number.NaN : Number(stated);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const locale = (single("locale") ?? "").trim();
  const page = count("page");
  const pageSize = count("pageSize");
  return { ...(locale === "" ? {} : { locale }), ...(page === undefined ? {} : { page }), ...(pageSize === undefined ? {} : { pageSize }) };
}
/** The Updates receiving list for the selected persona: both answers describe the same request and neither depends on the other, so they are read together. */
export default async function ReceivingPreviewPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const query = queryOf(await searchParams);
  const [result, development] = await Promise.all([reads.audience.readReceivingList(query), reads.dev.readDevState()]);
  const scope = result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
  return (
    <PageSurface headingId="receiving-preview-heading" title={SURFACE_TITLE}>
      <ReceivingList scope={scope} locale={"en-GB"} initialEnvelope={result} persona={personaOf(development)} params={query} />
    </PageSurface>
  );
}
