import type { Metadata } from "next";
import type { ReactElement } from "react";
import { DiscoveryIndex } from "@/features/audience/components/discovery-index";
import { reads, type Scope } from "@/modules/data-service";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Public pages" };
const NO_AUTHORITY_SCOPE: Scope = { organizationId: "" as Scope["organizationId"], ministryId: "" as Scope["ministryId"], supportSubjectId: "" as Scope["supportSubjectId"], principalId: "" as Scope["principalId"] };
/** The public discovery index: one read, and the family's own surface rendering that answer as it stands. */ export default async function PageDiscoveryIndexRoute(): Promise<ReactElement> {
  const result = await reads.audience.readDiscoveryIndex();
  const scope = result.kind === "envelope" ? result.envelope.scope : NO_AUTHORITY_SCOPE;
  return <DiscoveryIndex scope={scope} initialEnvelope={result} />;
}
