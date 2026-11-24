import { Temporal } from "temporal-polyfill";
import { isNonEmptyString } from "@/lib/guards";
import type { MemberChoice, MembershipRecord as DomainMembership } from "@/modules/audience/membership";
import type { ContentDocumentJson } from "@/modules/content/document";
import type { ContentDocument, ContentRevision, ContentVariant } from "@/modules/content/variant";
import type { ContentDocumentRecord, ContentVariantRecord, MembershipRecord as StoredMembership, Scope, SharePresentationRecord, StoredContentRevisionRecord } from "./envelope";
/** The domain edition one stored edition states, naming only the pointers it actually holds. */ export function contentVariantOf(record: ContentVariantRecord): ContentVariant {
  return {
    variantId: record.variantId,
    documentId: record.documentId,
    audience: record.audience,
    locale: { tag: record.locale, direction: record.direction },
    ...(record.draftRevisionId === null ? {} : { draftRevisionId: record.draftRevisionId }),
    ...(record.candidateId === null ? {} : { candidateId: record.candidateId }),
    ...(record.releaseHeadId === null ? {} : { releaseHeadId: record.releaseHeadId }),
    ...(record.translationSource === null ? {} : { translationSource: { variantId: record.translationSource.variantId, revisionId: record.translationSource.revisionId } }),
  };
}
/** The domain document one stored document states, naming the designation its giving binding points at. */ export function contentDocumentOf(record: ContentDocumentRecord): ContentDocument {
  return { documentId: record.documentId, family: record.family, kind: record.kind, sourceSubject: record.sourceSubject, siteId: record.siteId, ...(record.givingBinding === null ? {} : { givingBinding: record.givingBinding.designation }), managedFields: {} };
}
/** The domain revision one stored revision states, with the captions and alternative text its placements record. */ export function contentRevisionOf(record: StoredContentRevisionRecord, document: ContentDocumentJson): ContentRevision {
  const captions: Record<string, string> = {};
  const altText: Record<string, string> = {};
  for (const placement of record.mediaPlacements) {
    altText[placement.placementId] = placement.altText;
    if (placement.caption !== null) captions[placement.placementId] = placement.caption;
  }
  return {
    revisionId: record.revisionId,
    variantId: record.variantId,
    body: document,
    sections: document.sections,
    mediaPlacements: record.mediaPlacements.map((placement) => ({ placementId: placement.placementId, assetId: placement.assetId })),
    captions,
    altText,
    sharePresentation: sharePresentationOf(record.sharePresentation),
    contentChecksum: record.contentChecksum,
    authorPrincipalId: record.authorPrincipalId,
    createdAt: Temporal.Instant.from(record.createdAt),
  };
}
/** The domain membership one stored membership states, with the choice it implies and the revision ordinal it carries. */
export function membershipOf(record: StoredMembership, scope: Pick<Scope, "organizationId" | "ministryId">): DomainMembership {
  const acceptedAt = storedInstantOf(record.acceptedAt);
  const confirmation = storedInstantOf(record.confirmationDeadline);
  const choice: MemberChoice = record.state === "off" || record.state === "restricted" ? "off" : "immediate";
  return {
    membershipId: record.membershipId,
    scope: { organizationId: scope.organizationId, ministryId: scope.ministryId },
    publisherId: record.publisherId,
    purpose: record.purpose,
    recipientId: record.membershipId,
    email: record.email,
    state: record.state,
    choice,
    languagePreference: record.languagePreference ?? "",
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(acceptedAt !== undefined && record.state !== "awaiting-proof" ? { confirmedAt: acceptedAt } : {}),
    ...(confirmation === undefined ? {} : { confirmationDeadline: confirmation }),
    revision: revisionOrdinalOf(record.revision),
  };
}
/** A stored instant, or nothing when the record states none or states one this runtime cannot read. */ export function storedInstantOf(value: string | null | undefined): Temporal.Instant | undefined {
  if (value === null || value === undefined || value.length === 0) return undefined;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}
/** The ordinal a stored revision token ends in, so a stored `rev-7` reads as the domain's 7. */ export function revisionOrdinalOf(revision: string): number {
  const digits = /(\d+)\s*$/u.exec(revision);
  if (digits === null) return 1;
  const parsed = Number.parseInt(digits[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
function sharePresentationOf(record: SharePresentationRecord): { readonly title?: string; readonly description?: string; readonly imageAssetId?: string } {
  return { ...(isNonEmptyString(record.title) ? { title: record.title } : {}), ...(isNonEmptyString(record.description) ? { description: record.description } : {}), ...(record.imageAssetId === null ? {} : { imageAssetId: record.imageAssetId }) };
}
