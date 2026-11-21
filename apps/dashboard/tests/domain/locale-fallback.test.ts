/** Success criterion 17, at the one place locale fallback is decided: */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { withLanguagePreference, type MembershipRecord } from "@/modules/audience/membership";
import { admittedLocales, resolveLocale, type DocumentEdition, type LocaleResolution } from "@/modules/content/locale";
import type { ContentDocument, VariantAudience } from "@/modules/content/variant";
import { mutations, reads, type MutationInput } from "@/modules/data-service";
import { canReadProtected, resolveSession, type AccessDecision, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, isReadResult, type DenialReason, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, seed, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
// This file's own sessions: private ids, so no sibling suite's seeded world is shared or disturbed
const SESSION_ID = "domain-locale-fallback";
const SECOND_SESSION_ID = "domain-locale-fallback-second";
const READER_SESSION_ID = "domain-locale-fallback-reader";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
const SECOND_SOURCE: SessionSource = { sessionId: SECOND_SESSION_ID };
const READER_SOURCE: SessionSource = { sessionId: READER_SESSION_ID };
const UPDATE_DOCUMENT = "doc-update-autumn";
const PAGE_DOCUMENT = "doc-page-harbour-youth";
const HARBOUR_SITE = "site-harbour";
const OTHER_SITE = "site-otago";
const EN_PUBLIC_RELEASE = "release-update-en-1";
const EN_SUPPORTER_RELEASE = "release-update-en-approved-supporter-1";
const FR_RELEASE = "release-update-fr-1";
const FR_VARIANT = "variant-update-autumn-fr-public";
const AR_VARIANT = "variant-update-autumn-ar-public";
const AR_DRAFT_REVISION = "rev-update-ar-draft-1";
const AR_CANDIDATE = "rev-update-ar-candidate-1";
const PAGE_EN_RELEASE = "release-page-en-1";
const SUPPORTER_TITLE = "Autumn at Harbour Youth — for supporters";
// A Site that declares no default language is what the Page locale read states, so it is the baseline here
const NO_DECLARED_SITE_DEFAULT = "";
const BIDI_CONTROL_CODE_POINTS: readonly number[] = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const ARABIC_LETTERS = /[\u0600-\u06FF]+/u;
let seededWorld: Promise<readonly SeededSessionWithDocuments[]> | undefined;
function seededSessions(): Promise<readonly SeededSessionWithDocuments[]> {
  // One build for the whole file: the seed is deterministic, so re-laying a session always writes the
  // same bytes and every case starts from the same world.
  seededWorld ??= seed();
  return seededWorld;
}
function seededRow(sessions: readonly SeededSessionWithDocuments[], seededId: string): SeededSessionWithDocuments {
  const row = sessions.find((candidate) => candidate.sessionId === seededId);
  if (row === undefined) throw new Error(`The seed lays down no "${seededId}" session, so a case written against it has no world to start from.`);
  return row;
}
async function layDownSession(seededId: string, sessionId: string, sessions: readonly SeededSessionWithDocuments[]): Promise<void> {
  const { documents } = seededRow(sessions, seededId);
  const owned: SeededSessionDocuments = { ...documents, state: { ...documents.state, context: { ...documents.state.context, sessionId } } };
  await resetSession(sessionId, owned);
}
async function layDownWorld(): Promise<void> {
  const sessions = await seededSessions();
  await layDownSession(DEFAULT_SESSION_ID, SESSION_ID, sessions);
  await layDownSession("second-worker", SECOND_SESSION_ID, sessions);
  await layDownSession("reader-unauthorized", READER_SESSION_ID, sessions);
}
async function establishedState(): Promise<SessionStateDocument> {
  return seededRow(await seededSessions(), DEFAULT_SESSION_ID).documents.state;
}
beforeAll(async () => {
  await layDownWorld();
});

afterEach(async () => {
  // Every case starts from the seed's own bytes, so the one withdrawal below cannot reach the next case
  // and the file stays repeatable in any order.
  await layDownWorld();
});

afterAll(async () => {
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID, READER_SESSION_ID]) {
    await resetSession(sessionId);
  }
});
async function envelopeOf<T>(pending: Promise<ReadResult<T>>, what: string): Promise<T> {
  const result = await pending;
  if (!isReadResult(result)) throw new Error(`${what} answered with something that is not a read result: ${JSON.stringify(result)}`);
  if (result.kind !== "envelope") throw new Error(`${what} was refused rather than answered: ${JSON.stringify(result)}`);
  return result.envelope;
}
function outcomeNamed(outcome: MutationOutcome, expected: MutationOutcome["outcome"]): MutationOutcome {
  expect(isOutcome(outcome)).toBe(true);
  expect(outcome.outcome).toBe(expected);
  return outcome;
}
function denialOf(result: ReadResult<unknown>, what: string): { readonly reasonCode: DenialReason; readonly keys: readonly string[] } {
  if (result.kind !== "denied") throw new Error(`${what} was expected to be refused and was answered with ${JSON.stringify(result)}`);
  return { reasonCode: result.denied.reasonCode, keys: Object.keys(result.denied).sort() };
}
function sessionOf(resolution: Awaited<ReturnType<typeof resolveSession>>, what: string): ResolvedSession {
  if (!resolution.ok) throw new Error(`${what} could not be resolved, so no case can act as it: ${JSON.stringify(resolution.refusal)}`);
  return resolution.session;
}
interface EditionSet {
  readonly document: ContentDocument;
  readonly editions: readonly DocumentEdition[];
}
function contentDocumentOf(view: { readonly documentId: string; readonly family: ContentDocument["family"]; readonly kind: ContentDocument["kind"]; readonly sourceSubject: ContentDocument["sourceSubject"]; readonly siteId: string; readonly managedFieldKeys: readonly string[] }): ContentDocument {
  return { documentId: view.documentId, family: view.family, kind: view.kind, sourceSubject: view.sourceSubject, siteId: view.siteId, managedFields: Object.fromEntries(view.managedFieldKeys.map((key) => [key, ""])) };
}
async function editionsOf(documentId: string): Promise<EditionSet> {
  const envelope = await envelopeOf(reads.updates.readVariantOverview({ documentId, session: SOURCE }), `readVariantOverview(${documentId})`);
  const view = envelope.data.document;
  const document = contentDocumentOf(view);
  const editions: DocumentEdition[] = [];
  for (const edition of envelope.data.editions) {
    const head = edition.headRelease;
    if (head !== null) {
      editions.push({ ...head, documentId: view.documentId, siteId: view.siteId });
    }
  }
  return { document, editions };
}
/** The one release of a set that a variant publishes, so a case can restamp it without guessing at its index. */
function editionOf(set: EditionSet, variantId: string): DocumentEdition {
  const found = set.editions.find((edition) => edition.variantId === variantId);
  if (found === undefined) throw new Error(`The seeded world admits no release of ${variantId}, so this case cannot start from it.`);
  return found;
}
function servedEditionOf(set: EditionSet, resolution: Extract<LocaleResolution, { readonly status: "resolved" }>): DocumentEdition {
  const served = set.editions.find((edition) => edition.releaseId === resolution.release.releaseId && edition.locale.tag === resolution.servedLocale.tag);
  if (served === undefined) throw new Error(`The served release ${resolution.release.releaseId} is none of the editions this case supplied, so the answer came from outside them.`);
  return served;
}
/** Three states a reader can be answered with, kept apart so a surface cannot render one as another. */
type ResolutionState = "requested" | "fallback" | "language-unavailable";

function stateOf(resolution: LocaleResolution): ResolutionState {
  if (resolution.status === "language-unavailable") return "language-unavailable";
  return resolution.fallbackOccurred ? "fallback" : "requested";
}
function resolveEdition(set: EditionSet, requestedLocale: string, audience: VariantAudience, siteDefaultLocale: string = NO_DECLARED_SITE_DEFAULT): LocaleResolution {
  const resolution = resolveLocale({ document: set.document, releases: set.editions, audience, requestedLocale, siteDefaultLocale });
  // One unconditional set of assertions, so neither branch a case happens to take can skip the
  // invariant: the audience asked for is the audience served, and the locale reported is the locale
  // that release is published in.
  const served = resolution.status === "resolved" ? resolution : null;
  expect(resolution.requestedLocale).toBe(requestedLocale);
  expect(served === null ? audience : served.release.audience).toBe(audience);
  expect(served === null ? null : served.servedLocale.tag).toBe(served === null ? null : served.release.locale.tag);
  expect(served === null ? null : served.servedLocale.direction).toBe(served === null ? null : served.release.locale.direction);
  return resolution;
}
function resolved(resolution: LocaleResolution, what: string): Extract<LocaleResolution, { readonly status: "resolved" }> {
  if (resolution.status !== "resolved") throw new Error(`${what} was expected to be served and was answered with ${JSON.stringify(resolution)}`);
  return resolution;
}
/** The unavailable half of a resolution, or a failure naming what was served instead. */
function unavailableResolution(resolution: LocaleResolution, what: string): Extract<LocaleResolution, { readonly status: "language-unavailable" }> {
  if (resolution.status !== "language-unavailable") throw new Error(`${what} was expected to have no permitted edition and an edition was served: ${JSON.stringify(resolution)}`);
  return resolution;
}

describe("the locale a reader is actually served", () => {
  it("serves the requested language when an admitted edition of it exists, and says no fallback happened", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const resolution = resolved(resolveEdition(update, "fr", "public"), "a French request over a published French edition");
    // The French edition is published, so nothing was substituted: the flag is what a surface reads to
    // decide whether it must disclose a fallback at all.
    expect(resolution.fallbackOccurred).toBe(false);
    expect(resolution.servedLocale.tag).toBe("fr");
    expect(resolution.requestedLocale).toBe("fr");
    expect(resolution.release.releaseId).toBe(FR_RELEASE);
    expect(resolution.release.variantId).toBe(FR_VARIANT);
  });
  it("falls back to the Site's declared default and reports the actual language beside the requested one", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    // A reader who prefers German has no German edition; the Site declares English, so English is what
    // they are given — and the surface is told both tags, so it can say which language it is showing.
    const resolution = resolved(resolveEdition(update, "de", "public", "en"), "a German request over a Site whose default is English");
    expect(resolution.fallbackOccurred).toBe(true);
    expect(resolution.requestedLocale).toBe("de");
    expect(resolution.servedLocale.tag).toBe("en");
    expect(resolution.servedLocale.tag).not.toBe(resolution.requestedLocale);
    expect(resolution.release.releaseId).toBe(EN_PUBLIC_RELEASE);
  });
  it("keeps the requested locale, a fallback locale and Language unavailable as three distinct answers", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const served = resolveEdition(update, "fr", "public");
    const substituted = resolveEdition(update, "de", "public", "en");
    const refused = resolveEdition(update, "fr", "approved-supporter");
    const states = [stateOf(served), stateOf(substituted), stateOf(refused)];
    expect(states).toEqual(["requested", "fallback", "language-unavailable"]);
    expect(new Set(states).size).toBe(3);
    expect(states).toContain("requested");
    expect(states).toContain("fallback");
    expect(states).toContain("language-unavailable");
    const refusedAnswer = unavailableResolution(refused, "French for an approved-supporter audience with no declared default");
    expect(refusedAnswer.requestedLocale).toBe("fr");
  });
});

describe("fallback stays inside one document, one Site and one audience", () => {
  it("never serves another document's edition", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const page = await editionsOf(PAGE_DOCUMENT);
    // One list holding every edition of both documents, which is what a resolver that walked the Site
    // instead of the document would be handed.
    const acrossDocuments: EditionSet = { document: page.document, editions: [...update.editions, ...page.editions] };
    unavailableResolution(resolveEdition(acrossDocuments, "fr", "public"), "French on a Page that publishes no French edition");
    const sameDocument = resolved(resolveEdition(acrossDocuments, "fr", "public", "en"), "a French request on the Page with English declared");
    expect(sameDocument.release.releaseId).toBe(PAGE_EN_RELEASE);
    expect(servedEditionOf(acrossDocuments, sameDocument).documentId).toBe(PAGE_DOCUMENT);
    expect(servedEditionOf(acrossDocuments, sameDocument).documentId).not.toBe(UPDATE_DOCUMENT);
    // The same list answers the Update for the same request, which is what makes the bound a bound
    // rather than an absence of editions.
    const onItsOwnDocument = resolved(resolveEdition({ document: update.document, editions: [...update.editions, ...page.editions] }, "fr", "public"), "French on the Update that publishes it");
    expect(onItsOwnDocument.release.releaseId).toBe(FR_RELEASE);
    expect(servedEditionOf(acrossDocuments, onItsOwnDocument).documentId).toBe(UPDATE_DOCUMENT);
    // The service states the same refusal over the same document, so the bound is the application's and
    // not this file's arrangement of the list.
    const pageRead = await envelopeOf(reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, requestedLocale: "fr", session: SOURCE }), `readPageLocales(${PAGE_DOCUMENT}, fr)`);
    expect(pageRead.data.resolution.status).toBe("language-unavailable");
    expect(pageRead.data.requestedLocale).toBe("fr");
  });
  it("never serves an edition published on another Site", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const french = editionOf(update, FR_VARIANT);
    // The one variable is the Site the edition states: the request, the document and the editions are
    // otherwise identical.
    const onThisSite: EditionSet = { document: update.document, editions: update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, siteId: HARBOUR_SITE } : edition)) };
    const onAnotherSite: EditionSet = { document: update.document, editions: update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, siteId: OTHER_SITE } : edition)) };
    const servedHere = resolved(resolveEdition(onThisSite, "fr", "public"), "French published on the document's own Site");
    expect(servedHere.release.releaseId).toBe(FR_RELEASE);
    expect(servedEditionOf(onThisSite, servedHere).siteId).toBe(HARBOUR_SITE);
    unavailableResolution(resolveEdition(onAnotherSite, "fr", "public"), "the same French edition stamped with another Site");
  });
  it("never crosses the audience through fallback, in either direction", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    // An approved-supporter reader asking for French: the only French edition is public, and the only
    // edition they may be shown is the approved-supporter English one. Serving the public French
    // edition would hand protected readers public copy and public readers protected copy.
    const supporter = resolved(resolveEdition(update, "fr", "approved-supporter", "en"), "French for an approved-supporter audience over an approved-supporter English edition");
    expect(supporter.fallbackOccurred).toBe(true);
    expect(supporter.release.releaseId).toBe(EN_SUPPORTER_RELEASE);
    expect(supporter.release.audience).toBe("approved-supporter");
    expect(supporter.release.releaseId).not.toBe(EN_PUBLIC_RELEASE);
    const publicReader = resolved(resolveEdition(update, "de", "public", "en"), "German for a public audience over a public English edition");
    expect(publicReader.fallbackOccurred).toBe(true);
    expect(publicReader.release.releaseId).toBe(EN_PUBLIC_RELEASE);
    expect(publicReader.release.audience).toBe("public");
    expect(publicReader.release.releaseId).not.toBe(EN_SUPPORTER_RELEASE);
    expect(supporter.servedLocale.tag).toBe(publicReader.servedLocale.tag);
    expect(supporter.release.variantId).not.toBe(publicReader.release.variantId);
  });
});

describe("only currently admitted releases are served", () => {
  const PROTECTED_VARIANT = "variant-update-autumn-en-approved-supporter";
  it("drops a withdrawn edition from fallback in the same read that reports the withdrawal", async () => {
    const before = await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE });
    if (before.kind !== "envelope") throw new Error(`readVariantOverview(${UPDATE_DOCUMENT}) was refused: ${JSON.stringify(before)}`);
    // The withdrawal presents the document revision the overview states, because what it changes is one
    // release under that document.
    const input: MutationInput<{ readonly variantId: string }> = { operationId: newOperationId(), scope: before.envelope.scope, expectedRevision: before.envelope.revision, payload: { variantId: FR_VARIANT } };
    // Before the withdrawal the French edition was a language the switcher offered, which is what makes
    // its absence below a change rather than an absence that was always there.
    const beforeEditions = await editionsOf(UPDATE_DOCUMENT);
    const offeredBefore = admittedLocales({ document: beforeEditions.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: beforeEditions.editions });
    expect(offeredBefore.some((locale) => locale.releaseId === FR_RELEASE)).toBe(true);
    const withdrawal = outcomeNamed(await mutations.updates.withdrawLocale(SESSION_ID, input), "accepted");
    expect(withdrawal.outcome === "accepted" ? withdrawal.changed : undefined).toEqual([FR_RELEASE]);
    const after = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT}) after withdrawal`);
    const french = after.data.editions.find((edition) => edition.variantId === FR_VARIANT);
    if (french?.headRelease === null || french?.headRelease === undefined) throw new Error("The withdrawn edition reported no head release, so the withdrawal could not be seen.");
    expect(french.headRelease.releaseId).toBe(FR_RELEASE);
    expect(french.headRelease.withdrawnAt).toBeDefined();
    // The same editions, resolved again: the withdrawn head is still the variant's head record, and the
    // resolver must refuse it rather than serve a publication that no longer stands.
    const update = await editionsOf(UPDATE_DOCUMENT);
    expect(editionOf(update, FR_VARIANT).withdrawnAt).toBeDefined();
    unavailableResolution(resolveEdition(update, "fr", "public"), "French after its edition was withdrawn");
    const fallback = resolved(resolveEdition(update, "fr", "public", "en"), "French after withdrawal, with English declared");
    expect(fallback.fallbackOccurred).toBe(true);
    expect(fallback.release.releaseId).toBe(EN_PUBLIC_RELEASE);
    expect(fallback.release.releaseId).not.toBe(FR_RELEASE);
    const choosable = admittedLocales({ document: update.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: update.editions });
    expect(choosable.some((locale) => locale.releaseId === FR_RELEASE)).toBe(false);
  });
  it("never serves a draft or a frozen candidate as if it were a release", async () => {
    const update = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT})`);
    const arabic = update.data.editions.find((edition) => edition.variantId === AR_VARIANT);
    if (arabic === undefined) throw new Error(`The seeded world holds no ${AR_VARIANT} edition, so this case cannot start from it.`);
    expect(arabic.draftRevisionId).toBe(AR_DRAFT_REVISION);
    expect(arabic.candidateId).toBe(AR_CANDIDATE);
    expect(arabic.releaseHeadId).toBeNull();
    expect(arabic.headRelease).toBeNull();
    const editions = await editionsOf(UPDATE_DOCUMENT);
    expect(editions.editions.some((edition) => edition.variantId === AR_VARIANT)).toBe(false);
    const resolution = resolved(resolveEdition(editions, "ar", "public", "en"), "Arabic with English declared");
    expect(resolution.fallbackOccurred).toBe(true);
    expect(resolution.servedLocale.tag).toBe("en");
    const serialised = JSON.stringify(resolution);
    expect(serialised).not.toContain(AR_DRAFT_REVISION);
    expect(serialised).not.toContain(AR_CANDIDATE);
    expect(serialised).not.toContain(AR_VARIANT);
  });
  it("reveals nothing at all about an edition the caller may not read", async () => {
    const supporter = await envelopeOf(reads.updates.readRelease({ variantId: PROTECTED_VARIANT, session: SOURCE }), `readRelease(${PROTECTED_VARIANT})`);
    if (supporter.data.status !== "released") throw new Error(`The approved-supporter edition stands in ${supporter.data.status}, so the protected title this case looks for could not be read.`);
    expect(supporter.data.revision.sharePresentation.title).toBe(SUPPORTER_TITLE);
    const secondWorker = await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SECOND_SOURCE });
    const otherMinistry = denialOf(secondWorker, `readVariantOverview(${UPDATE_DOCUMENT}) as another ministry's worker`);
    expect(otherMinistry.reasonCode).toBe("no-permission");
    expect([...otherMinistry.keys]).toEqual(["operationId", "outcome", "reasonCode"]);
    const otherMinistryText = JSON.stringify(secondWorker);
    expect(otherMinistryText).not.toContain(SUPPORTER_TITLE);
    expect(otherMinistryText).not.toContain(EN_SUPPORTER_RELEASE);
    expect(otherMinistryText).not.toContain(FR_RELEASE);
    expect(otherMinistryText).not.toContain(UPDATE_DOCUMENT);
    // A reader persona is refused the same way: it holds no ministry membership, so no content read
    // reaches an enumeration it could count.
    const readerPage = await reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, session: READER_SOURCE });
    const readerRefusal = denialOf(readerPage, `readPageLocales(${PAGE_DOCUMENT}) as a reader persona`);
    expect(readerRefusal.reasonCode).toBe("not-admitted");
    expect([...readerRefusal.keys]).toEqual(["operationId", "outcome", "reasonCode"]);
    const protectedRead = denialOf(await reads.updates.readRelease({ variantId: PROTECTED_VARIANT, session: READER_SOURCE }), `readRelease(${PROTECTED_VARIANT}) as a reader persona`);
    expect(protectedRead.reasonCode).toBe("not-admitted");
    const update = await editionsOf(UPDATE_DOCUMENT);
    const choosable = admittedLocales({ document: update.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: update.editions });
    expect(choosable.map((locale) => locale.releaseId).sort()).toEqual([EN_PUBLIC_RELEASE, FR_RELEASE].sort());
    expect(choosable.some((locale) => locale.releaseId === EN_SUPPORTER_RELEASE)).toBe(false);
    expect(choosable.some((locale) => locale.tag === "ar")).toBe(false);
    const served = resolved(resolveEdition(update, "en", "public"), "English for a public reader");
    expect(Object.keys(served).sort()).toEqual(["fallbackOccurred", "release", "requestedLocale", "servedLocale", "status"]);
    expect(served).not.toHaveProperty("title");
    expect(served).not.toHaveProperty("editions");
    expect(served).not.toHaveProperty("count");
    expect(served).not.toHaveProperty("total");
    expect(served.release).not.toHaveProperty("title");
    expect(served.release).not.toHaveProperty("sharePresentation");
    const servedText = JSON.stringify(served);
    expect(servedText).not.toContain(SUPPORTER_TITLE);
    expect(servedText).not.toContain(EN_SUPPORTER_RELEASE);
    expect(servedText).not.toContain("approved-supporter");
  });
});

const CHOICE_BY_STATE: Readonly<Record<MembershipRecord["state"], MembershipRecord["choice"]>> = { active: "immediate", "awaiting-proof": "immediate", off: "off", restricted: "off" };
function revisionOrdinalOf(revision: string): number {
  const digits = revision.replace(/[^0-9]/gu, "");
  return digits.length === 0 ? 0 : Number.parseInt(digits, 10);
}
function membershipFrom(state: SessionStateDocument, membershipId: string): MembershipRecord {
  const stored = state.memberships.find((candidate) => candidate.membershipId === membershipId);
  if (stored === undefined) throw new Error(`The seeded world holds no ${membershipId} membership, so this case cannot start from it.`);
  const { selectedOrganizationId, selectedMinistryId } = state.context;
  if (selectedOrganizationId === null || selectedMinistryId === null) throw new Error("The seeded worker selects no organisation and ministry, so no membership belongs to a stated authority.");
  return {
    membershipId: stored.membershipId,
    scope: { organizationId: selectedOrganizationId, ministryId: selectedMinistryId },
    publisherId: stored.publisherId,
    purpose: stored.purpose,
    recipientId: stored.membershipId,
    email: stored.email,
    state: stored.state,
    choice: CHOICE_BY_STATE[stored.state],
    languagePreference: stored.languagePreference ?? "",
    ...(stored.acceptedAt === null ? {} : { acceptedAt: Temporal.Instant.from(stored.acceptedAt) }),
    ...(stored.confirmationDeadline === null ? {} : { confirmationDeadline: Temporal.Instant.from(stored.confirmationDeadline) }),
    revision: revisionOrdinalOf(stored.revision),
  };
}
/** One permission answer as two comparable facts, so a decision before and after a change can be compared whole. */
function grantOf(decision: AccessDecision): { readonly allowed: boolean; readonly reasonCode: DenialReason | null } {
  return decision.allowed ? { allowed: true, reasonCode: null } : { allowed: false, reasonCode: decision.denial.reasonCode };
}

describe("a language preference is neither consent nor access", () => {
  it("keeps the state, the Off/Immediate choice, the confirmation deadline and the language as four separate facts", async () => {
    const state = await establishedState();
    const awaitingProof = membershipFrom(state, "membership-awaiting-proof");
    expect(awaitingProof.languagePreference).toBe("cy");
    expect(awaitingProof.state).toBe("awaiting-proof");
    expect(awaitingProof.choice).toBe("immediate");
    expect(awaitingProof.confirmationDeadline).toBeInstanceOf(Temporal.Instant);
    const active = membershipFrom(state, "membership-ada-active");
    expect(active.state).toBe("active");
    expect(active.choice).toBe("immediate");
    const off = membershipFrom(state, "membership-unsubscribed");
    expect(off.state).toBe("off");
    expect(off.choice).toBe("off");
    const restricted = membershipFrom(state, "membership-restricted");
    expect(restricted.state).toBe("restricted");
    expect(restricted.choice).toBe("off");
  });
  it("changes nothing but the language when the reader changes it", async () => {
    const state = await establishedState();
    const reader = sessionOf(await resolveSession(READER_SOURCE), "the reader persona's session");
    expect(reader.admittedMemberships).toEqual([]);
    const cases = [
      { membershipId: "membership-ada-active", granted: true },
      // Awaiting proof is not membership: the address has not been confirmed, so nothing is readable yet.
      { membershipId: "membership-awaiting-proof", granted: false },
      { membershipId: "membership-unsubscribed", granted: true },
      { membershipId: "membership-restricted", granted: false },
    ] as const;
    expect(cases.length).toBe(4);
    for (const { membershipId, granted } of cases) {
      const record = membershipFrom(state, membershipId);
      const before = grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: { recipientId: record.recipientId, publisherId: record.publisherId, purpose: record.purpose, memberships: [record] } }));
      expect(before.allowed).toBe(granted);
      const relanguaged = withLanguagePreference(record, "ar");
      expect(relanguaged.languagePreference).toBe("ar");
      expect(relanguaged.state).toBe(record.state);
      expect(relanguaged.choice).toBe(record.choice);
      expect(relanguaged.confirmationDeadline).toEqual(record.confirmationDeadline);
      expect(relanguaged.acceptedAt).toEqual(record.acceptedAt);
      expect(relanguaged.revision).toBe(record.revision + 1);
      const after = grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: { recipientId: relanguaged.recipientId, publisherId: relanguaged.publisherId, purpose: relanguaged.purpose, memberships: [relanguaged] } }));
      expect(after).toEqual(before);
    }
  });
  it("does not turn a language setting into access to a protected edition", async () => {
    const reader = sessionOf(await resolveSession(READER_SOURCE), "the reader persona's session");
    const reasonCodes = new Set<string>();
    for (const requestedLocale of ["en", "ar", "fr", "cy"]) {
      const page = await reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, requestedLocale, session: READER_SOURCE });
      reasonCodes.add(denialOf(page, `readPageLocales(${PAGE_DOCUMENT}, ${requestedLocale}) as a reader persona`).reasonCode);
      const release = await reads.updates.readRelease({ variantId: "variant-update-autumn-en-approved-supporter", session: READER_SOURCE });
      reasonCodes.add(denialOf(release, `readRelease for ${requestedLocale} as a reader persona`).reasonCode);
      // The permission question itself takes no language at all: a protected read is decided from the
      // grant, so a preference can neither widen nor narrow it.
      expect(grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: null }))).toEqual({ allowed: false, reasonCode: "no-protected-grant" });
    }
    expect([...reasonCodes]).toEqual(["not-admitted"]);
  });
  it("never changes the audience as a side effect of resolving a language", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const asPublic = resolved(resolveEdition(update, "de", "public", "en"), "German for the public audience");
    const asSupporter = resolved(resolveEdition(update, "de", "approved-supporter", "en"), "German for the approved-supporter audience");
    expect(asPublic.release.audience).toBe("public");
    expect(asSupporter.release.audience).toBe("approved-supporter");
    expect(asPublic.release.releaseId).toBe(EN_PUBLIC_RELEASE);
    expect(asSupporter.release.releaseId).toBe(EN_SUPPORTER_RELEASE);
    expect(asPublic.release.releaseId).not.toBe(asSupporter.release.releaseId);
  });
});

describe("direction is content, not styling", () => {
  it("carries the direction on the edition record, with a BCP-47 language tag", async () => {
    const overview = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT})`);
    // Every tag is a BCP-47 language tag: a two- or three-letter language subtag, and nothing that would
    // have to be guessed at.
    expect(overview.data.editions.length).toBeGreaterThan(0);
    for (const edition of overview.data.editions) {
      expect(edition.locale.tag).toMatch(/^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u);
    }
    // The Arabic edition is right-to-left and the English and French ones are left-to-right, stated on
    // the record rather than left to the reader to infer from the tag. The Arabic edition is a draft, so
    // it is asserted on the edition record, which carries its direction before it is ever released.
    const arabic = overview.data.editions.find((edition) => edition.variantId === AR_VARIANT);
    expect(arabic?.locale).toEqual({ tag: "ar", direction: "rtl" });
    const update = await editionsOf(UPDATE_DOCUMENT);
    expect(editionOf(update, "variant-update-autumn-en-public").locale).toEqual({ tag: "en", direction: "ltr" });
    expect(editionOf(update, FR_VARIANT).locale).toEqual({ tag: "fr", direction: "ltr" });
    const pageRead = await envelopeOf(reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, session: SOURCE }), `readPageLocales(${PAGE_DOCUMENT})`);
    const pageArabic = pageRead.data.editions.find((edition) => edition.locale.tag === "ar");
    expect(pageArabic?.locale).toEqual({ tag: "ar", direction: "rtl" });
  });
  it("preserves the direction the record states instead of inferring it from the tag", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const english = editionOf(update, "variant-update-autumn-en-public");
    // One tag, two records that differ only in the direction they state. A resolver that decided the
    // direction from the language tag would answer the same way for both; the record is what decides.
    const statedLeftToRight: EditionSet = { document: update.document, editions: [{ ...english, locale: { tag: "ku", direction: "ltr" } }] };
    const statedRightToLeft: EditionSet = { document: update.document, editions: [{ ...english, locale: { tag: "ku", direction: "rtl" } }] };
    const leftToRight = resolved(resolveEdition(statedLeftToRight, "ku", "public"), "an edition whose record states left-to-right");
    const rightToLeft = resolved(resolveEdition(statedRightToLeft, "ku", "public"), "an edition whose record states right-to-left");
    expect(leftToRight.servedLocale).toEqual({ tag: "ku", direction: "ltr" });
    expect(rightToLeft.servedLocale).toEqual({ tag: "ku", direction: "rtl" });
    const fallback = resolved(resolveEdition(update, "ar", "public", "en"), "Arabic answered with the English edition");
    expect(fallback.servedLocale).toEqual({ tag: "en", direction: "ltr" });
  });
  it("stores no bidi control character in the seeded Arabic content", async () => {
    for (const variantId of [AR_VARIANT, "variant-page-harbour-youth-ar-public"]) {
      const draft = await envelopeOf(reads.updates.readDraft({ variantId, session: SOURCE }), `readDraft(${variantId})`);
      if (draft.data.status !== "draft") throw new Error(`The seeded ${variantId} edition holds no draft, so its stored content cannot be inspected.`);
      const body = draft.data.revision.body;
      expect(body.direction).toBe("rtl");
      const text = JSON.stringify(body);
      expect(text).toMatch(ARABIC_LETTERS);
      for (const codePoint of BIDI_CONTROL_CODE_POINTS) {
        expect(text).not.toContain(String.fromCodePoint(codePoint));
      }
      for (const section of body.sections) {
        for (const value of Object.values(section.fields)) {
          for (const codePoint of BIDI_CONTROL_CODE_POINTS) {
            expect(value).not.toContain(String.fromCodePoint(codePoint));
          }
        }
      }
    }
  });
  it("refuses an unrecognised language tag instead of resolving it to a default", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const refused = unavailableResolution(resolveEdition(update, "English (US)", "public"), "a language display name instead of a tag");
    expect(refused.requestedLocale).toBe("English (US)");
    // With a declared default the Site's edition is served, and it is reported as the substitution it is
    // rather than as an exact match on the request.
    const substituted = resolved(resolveEdition(update, "English (US)", "public", "en"), "a language display name with English declared");
    expect(substituted.fallbackOccurred).toBe(true);
    expect(substituted.servedLocale.tag).toBe("en");
    expect(substituted.servedLocale.tag).not.toBe(substituted.requestedLocale);
    expect(substituted.release.releaseId).toBe(EN_PUBLIC_RELEASE);
  });
});
