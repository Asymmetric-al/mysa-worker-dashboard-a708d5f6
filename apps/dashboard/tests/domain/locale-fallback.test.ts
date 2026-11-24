/** Success criterion 17, at the one place locale fallback is decided: the language a reader is served, the fallback that stays inside one document, one Site and one audience, the releases it may read, a preference that is neither consent nor access, and direction carried by the content rather than by styling. */
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { newOperationId } from "@/lib/ids";
import { withLanguagePreference, type MembershipRecord } from "@/modules/audience/membership";
import { admittedLocales, directionOfTag, resolveLocale, type DocumentEdition, type LocaleInput, type LocaleResolution } from "@/modules/content/locale";
import type { ContentDocument, VariantAudience } from "@/modules/content/variant";
import { mutations, reads, type MutationInput } from "@/modules/data-service";
import { canReadProtected, resolveSession, type AccessDecision, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { isOutcome, isReadResult, type DenialReason, type MutationOutcome, type ReadResult } from "@/modules/data-service/outcome";
import { DEFAULT_SESSION_ID, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstSaying, throwing } from "../helpers/answers";
import { layDownSeededSession, seededDocuments } from "../helpers/fixtures";
const SESSION_ID = "domain-locale-fallback"; // This file's own sessions: private ids, so no sibling suite's seeded world is shared or disturbed
const SECOND_SESSION_ID = "domain-locale-fallback-second";
const READER_SESSION_ID = "domain-locale-fallback-reader";
const SOURCE: SessionSource = { sessionId: SESSION_ID };
const SECOND_SOURCE: SessionSource = { sessionId: SECOND_SESSION_ID };
const READER_SOURCE: SessionSource = { sessionId: READER_SESSION_ID };
const UPDATE_DOCUMENT = "doc-update-autumn";
const PAGE_DOCUMENT = "doc-page-harbour-youth";
const HARBOUR_SITE = "site-harbour";
const EN_PUBLIC_RELEASE = "release-update-en-1";
const EN_SUPPORTER_RELEASE = "release-update-en-approved-supporter-1";
const FR_RELEASE = "release-update-fr-1";
const FR_VARIANT = "variant-update-autumn-fr-public";
const AR_VARIANT = "variant-update-autumn-ar-public";
const AR_DRAFT_REVISION = "rev-update-ar-draft-1";
const AR_CANDIDATE = "rev-update-ar-candidate-1";
const SUPPORTER_TITLE = "Autumn at Harbour Youth — for supporters";
const NO_DECLARED_SITE_DEFAULT = ""; // A Site that declares no default language is what the Page locale read states, so it is the baseline here
const BIDI_CONTROL_CODE_POINTS: readonly number[] = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
async function layDownWorld(): Promise<void> {
  await layDownSeededSession(SESSION_ID, DEFAULT_SESSION_ID);
  await layDownSeededSession(SECOND_SESSION_ID, "second-worker");
  await layDownSeededSession(READER_SESSION_ID, "reader-unauthorized");
}
const establishedState = async (): Promise<SessionStateDocument> => (await seededDocuments(DEFAULT_SESSION_ID)).state;
beforeAll(async () => await layDownWorld());
afterEach(async () => {
  await layDownWorld(); // Every case starts from the seed's own bytes, so the one withdrawal below cannot reach the next case and the file stays repeatable in any order.
});
afterAll(async () => {
  for (const sessionId of [SESSION_ID, SECOND_SESSION_ID, READER_SESSION_ID]) await resetSession(sessionId);
});
async function envelopeOf<T>(pending: Promise<ReadResult<T>>, what: string): Promise<T> {
  const result = await pending;
  if (!isReadResult(result)) throw new Error(`${what} answered with something that is not a read result: ${JSON.stringify(result)}`);
  if (result.kind !== "envelope") throw new Error(`${what} was refused rather than answered: ${JSON.stringify(result)}`);
  return result.envelope;
}
function outcomeNamed(outcome: MutationOutcome, expected: MutationOutcome["outcome"]): MutationOutcome {
  expect([isOutcome(outcome), outcome.outcome]).toEqual([true, expected]);
  return outcome;
}
function denialOf(result: ReadResult<unknown>, what: string): { readonly reasonCode: DenialReason; readonly keys: readonly string[] } {
  if (result.kind !== "denied") throw new Error(`${what} was expected to be refused and was answered with ${JSON.stringify(result)}`);
  return { reasonCode: result.denied.reasonCode, keys: Object.keys(result.denied).sort() };
}
const sessionOf = (resolution: Awaited<ReturnType<typeof resolveSession>>, what: string): ResolvedSession => (resolution.ok ? resolution.session : throwing(`${what} could not be resolved, so no case can act as it: ${JSON.stringify(resolution.refusal)}`));
type EditionSet = { readonly document: ContentDocument; readonly editions: readonly DocumentEdition[] };
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
    if (head !== null) editions.push({ ...head, documentId: view.documentId, siteId: view.siteId });
  }
  return { document, editions };
}
/** The one release of a set that a variant publishes, so a case can restamp it without guessing at its index. */
const editionOf = (set: EditionSet, variantId: string): DocumentEdition => firstSaying(set.editions, "variantId", variantId, `The seeded world admits no release of ${variantId}, so this case cannot start from it.`);
function servedEditionOf(set: EditionSet, resolution: Extract<LocaleResolution, { readonly status: "resolved" }>): DocumentEdition {
  const served = set.editions.find((edition) => edition.releaseId === resolution.release.releaseId && edition.locale.tag === resolution.servedLocale.tag);
  if (served === undefined) throw new Error(`The served release ${resolution.release.releaseId} is none of the editions this case supplied, so the answer came from outside them.`);
  return served;
}
/** Three states a reader can be answered with, kept apart so a surface cannot render one as another. */ type ResolutionState = "requested" | "fallback" | "language-unavailable";
const stateOf = (resolution: LocaleResolution): ResolutionState => (resolution.status === "language-unavailable" ? "language-unavailable" : resolution.fallbackOccurred ? "fallback" : "requested");
function checkedResolution(input: LocaleInput, requestedLocale: string, audience: VariantAudience): LocaleResolution {
  const resolution = resolveLocale(input);
  const served = resolution.status === "resolved" ? resolution : null; // One unconditional set of assertions, so neither branch a case happens to take can skip the invariant: the audience asked for is the audience served, and the locale reported is the locale that release is published in.
  expect([resolution.requestedLocale, served === null ? audience : served.release.audience, served === null ? null : served.servedLocale.tag]).toEqual([requestedLocale, audience, served === null ? null : served.release.locale.tag]);
  expect(served === null ? null : served.servedLocale.direction).toBe(served === null ? null : served.release.locale.direction);
  return resolution;
}
function resolveEdition(set: EditionSet, requestedLocale: string, audience: VariantAudience, siteDefaultLocale: string = NO_DECLARED_SITE_DEFAULT): LocaleResolution {
  return checkedResolution({ document: set.document, releases: set.editions, audience, requestedLocale, siteDefaultLocale }, requestedLocale, audience);
}
/** The same resolution a receiving reader gets: the exact policy, with another admitted language of the same document, Site and audience admitted as a substitute. */
function resolveForReader(set: EditionSet, requestedLocale: string, audience: VariantAudience, siteDefaultLocale: string = NO_DECLARED_SITE_DEFAULT): LocaleResolution {
  return checkedResolution({ document: set.document, releases: set.editions, audience, requestedLocale, siteDefaultLocale, substituteLanguage: true }, requestedLocale, audience);
}
const resolved = (resolution: LocaleResolution, what: string): Extract<LocaleResolution, { readonly status: "resolved" }> => (resolution.status === "resolved" ? resolution : throwing(`${what} was expected to be served and was answered with ${JSON.stringify(resolution)}`));
/** The unavailable half of a resolution, or a failure naming what was served instead. */ function unavailableResolution(resolution: LocaleResolution, what: string): Extract<LocaleResolution, { readonly status: "language-unavailable" }> {
  if (resolution.status !== "language-unavailable") throw new Error(`${what} was expected to have no permitted edition and an edition was served: ${JSON.stringify(resolution)}`);
  return resolution;
}
it("the locale a reader is actually served: serves the requested language when an admitted edition of it exists, and says no fallback happened", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  const resolution = resolved(resolveEdition(update, "fr", "public"), "a French request over a published French edition");
  // The French edition is published, so nothing was substituted: the flag is what a surface reads to decide whether it must disclose a fallback at all.
  expect([resolution.fallbackOccurred, resolution.servedLocale.tag, resolution.requestedLocale, resolution.release.releaseId, resolution.release.variantId]).toEqual([false, "fr", "fr", FR_RELEASE, FR_VARIANT]);
});
it("the locale a reader is actually served: falls back to the Site's declared default and reports the actual language beside the requested one", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  // A reader who prefers German has no German edition; the Site declares English, so English is what they are given — and the surface is told both tags, so it can say which language it is showing.
  const resolution = resolved(resolveEdition(update, "de", "public", "en"), "a German request over a Site whose default is English");
  expect([resolution.fallbackOccurred, resolution.requestedLocale, resolution.servedLocale.tag]).toEqual([true, "de", "en"]);
  expect(resolution.servedLocale.tag).not.toBe(resolution.requestedLocale);
  expect(resolution.release.releaseId).toBe(EN_PUBLIC_RELEASE);
});
it("the locale a reader is actually served: keeps the requested locale, a fallback locale and Language unavailable as three distinct answers", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  const served = resolveEdition(update, "fr", "public");
  const substituted = resolveEdition(update, "de", "public", "en");
  const refused = resolveEdition(update, "fr", "approved-supporter");
  const states = [stateOf(served), stateOf(substituted), stateOf(refused)];
  expect([states, new Set(states).size]).toEqual([["requested", "fallback", "language-unavailable"], 3]);
  for (const needle of ["requested", "fallback", "language-unavailable"]) expect(states).toContain(needle);
  expect(unavailableResolution(refused, "French for an approved-supporter audience with no declared default").requestedLocale).toBe("fr");
});
it("fallback stays inside one document, one Site and one audience: never serves another document's edition", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  const page = await editionsOf(PAGE_DOCUMENT);
  const acrossDocuments: EditionSet = { document: page.document, editions: [...update.editions, ...page.editions] }; // One list holding every edition of both documents, which is what a resolver that walked the Site instead of the document would be handed.
  unavailableResolution(resolveEdition(acrossDocuments, "fr", "public"), "French on a Page that publishes no French edition");
  const sameDocument = resolved(resolveEdition(acrossDocuments, "fr", "public", "en"), "a French request on the Page with English declared");
  expect([sameDocument.release.releaseId, servedEditionOf(acrossDocuments, sameDocument).documentId]).toEqual(["release-page-en-1", PAGE_DOCUMENT]);
  expect(servedEditionOf(acrossDocuments, sameDocument).documentId).not.toBe(UPDATE_DOCUMENT);
  // The same list answers the Update for the same request, which is what makes the bound a bound rather than an absence of editions.
  const onItsOwnDocument = resolved(resolveEdition({ document: update.document, editions: [...update.editions, ...page.editions] }, "fr", "public"), "French on the Update that publishes it");
  expect([onItsOwnDocument.release.releaseId, servedEditionOf(acrossDocuments, onItsOwnDocument).documentId]).toEqual([FR_RELEASE, UPDATE_DOCUMENT]);
  const pageRead = await envelopeOf(reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, requestedLocale: "fr", session: SOURCE }), `readPageLocales(${PAGE_DOCUMENT}, fr)`); // The service states the same refusal over the same document, so the bound is the application's and not this file's arrangement of the list.
  expect([pageRead.data.resolution.status, pageRead.data.requestedLocale]).toEqual(["language-unavailable", "fr"]);
});
it("fallback stays inside one document, one Site and one audience: never serves an edition published on another Site", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  const french = editionOf(update, FR_VARIANT);
  const onThisSite: EditionSet = { document: update.document, editions: update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, siteId: HARBOUR_SITE } : edition)) }; // The one variable is the Site the edition states: the request, the document and the editions are otherwise identical.
  const onAnotherSite: EditionSet = { document: update.document, editions: update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, siteId: "site-otago" } : edition)) };
  const servedHere = resolved(resolveEdition(onThisSite, "fr", "public"), "French published on the document's own Site");
  expect([servedHere.release.releaseId, servedEditionOf(onThisSite, servedHere).siteId]).toEqual([FR_RELEASE, HARBOUR_SITE]);
  unavailableResolution(resolveEdition(onAnotherSite, "fr", "public"), "the same French edition stamped with another Site");
});
it("fallback stays inside one document, one Site and one audience: never crosses the audience through fallback, in either direction", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  // An approved-supporter reader asking for French: the only French edition is public, and the only edition they may be shown is the approved-supporter English one. Serving the public French edition would hand protected readers public copy and public readers protected copy.
  const supporter = resolved(resolveEdition(update, "fr", "approved-supporter", "en"), "French for an approved-supporter audience over an approved-supporter English edition");
  expect([supporter.fallbackOccurred, supporter.release.releaseId, supporter.release.audience]).toEqual([true, EN_SUPPORTER_RELEASE, "approved-supporter"]);
  expect(supporter.release.releaseId).not.toBe(EN_PUBLIC_RELEASE);
  const publicReader = resolved(resolveEdition(update, "de", "public", "en"), "German for a public audience over a public English edition");
  expect([publicReader.fallbackOccurred, publicReader.release.releaseId, publicReader.release.audience]).toEqual([true, EN_PUBLIC_RELEASE, "public"]);
  expect(publicReader.release.releaseId).not.toBe(EN_SUPPORTER_RELEASE);
  expect(supporter.servedLocale.tag).toBe(publicReader.servedLocale.tag);
  expect(supporter.release.variantId).not.toBe(publicReader.release.variantId);
});
describe("only currently admitted releases are served", () => {
  const PROTECTED_VARIANT = "variant-update-autumn-en-approved-supporter";
  it("drops a withdrawn edition from fallback in the same read that reports the withdrawal", async () => {
    const before = expectEnvelope(await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT})`);
    // The withdrawal presents the document revision the overview states, because what it changes is one release under that document.
    const input: MutationInput<{ readonly variantId: string }> = { operationId: newOperationId(), scope: before.scope, expectedRevision: before.revision, payload: { variantId: FR_VARIANT } };
    const beforeEditions = await editionsOf(UPDATE_DOCUMENT); // Before the withdrawal the French edition was a language the switcher offered, which is what makes its absence below a change rather than an absence that was always there.
    const offeredBefore = admittedLocales({ document: beforeEditions.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: beforeEditions.editions });
    expect(offeredBefore.some((locale) => locale.releaseId === FR_RELEASE)).toBe(true);
    const withdrawal = outcomeNamed(await mutations.updates.withdrawLocale(SESSION_ID, input), "accepted");
    expect(withdrawal.outcome === "accepted" ? withdrawal.changed : undefined).toEqual([FR_RELEASE]);
    const after = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT}) after withdrawal`);
    const french = after.data.editions.find((edition) => edition.variantId === FR_VARIANT);
    if (french?.headRelease === null || french?.headRelease === undefined) throw new Error("The withdrawn edition reported no head release, so the withdrawal could not be seen.");
    expect(french.headRelease.releaseId).toBe(FR_RELEASE);
    expect(french.headRelease.withdrawnAt).toBeDefined();
    const update = await editionsOf(UPDATE_DOCUMENT); // The same editions, resolved again: the withdrawn head is still the variant's head record, and the resolver must refuse it rather than serve a publication that no longer stands.
    expect(editionOf(update, FR_VARIANT).withdrawnAt).toBeDefined();
    unavailableResolution(resolveEdition(update, "fr", "public"), "French after its edition was withdrawn");
    const fallback = resolved(resolveEdition(update, "fr", "public", "en"), "French after withdrawal, with English declared");
    expect([fallback.fallbackOccurred, fallback.release.releaseId]).toEqual([true, EN_PUBLIC_RELEASE]);
    expect(fallback.release.releaseId).not.toBe(FR_RELEASE);
    const choosable = admittedLocales({ document: update.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: update.editions });
    expect(choosable.some((locale) => locale.releaseId === FR_RELEASE)).toBe(false);
  });
  it("never serves a draft or a frozen candidate as if it were a release", async () => {
    const update = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT})`);
    const arabic = firstSaying(update.data.editions, "variantId", AR_VARIANT, `The seeded world holds no ${AR_VARIANT} edition, so this case cannot start from it.`);
    expect([arabic.draftRevisionId, arabic.candidateId]).toEqual([AR_DRAFT_REVISION, AR_CANDIDATE]);
    expect(arabic.releaseHeadId).toBeNull();
    expect(arabic.headRelease).toBeNull();
    const editions = await editionsOf(UPDATE_DOCUMENT);
    expect(editions.editions.some((edition) => edition.variantId === AR_VARIANT)).toBe(false);
    const resolution = resolved(resolveEdition(editions, "ar", "public", "en"), "Arabic with English declared");
    expect([resolution.fallbackOccurred, resolution.servedLocale.tag]).toEqual([true, "en"]);
    for (const expected of [AR_DRAFT_REVISION, AR_CANDIDATE, AR_VARIANT]) expect(JSON.stringify(resolution)).not.toContain(expected);
  });
  it("reveals nothing at all about an edition the caller may not read", async () => {
    const supporter = await envelopeOf(reads.updates.readRelease({ variantId: PROTECTED_VARIANT, session: SOURCE }), `readRelease(${PROTECTED_VARIANT})`);
    if (supporter.data.status !== "released") throw new Error(`The approved-supporter edition stands in ${supporter.data.status}, so the protected title this case looks for could not be read.`);
    expect(supporter.data.revision.sharePresentation.title).toBe(SUPPORTER_TITLE);
    const secondWorker = await reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SECOND_SOURCE });
    const otherMinistry = denialOf(secondWorker, `readVariantOverview(${UPDATE_DOCUMENT}) as another ministry's worker`);
    expect(otherMinistry.reasonCode).toBe("no-permission");
    expect([...otherMinistry.keys]).toEqual(["operationId", "outcome", "reasonCode"]);
    for (const expected of [SUPPORTER_TITLE, EN_SUPPORTER_RELEASE, FR_RELEASE, UPDATE_DOCUMENT]) expect(JSON.stringify(secondWorker)).not.toContain(expected);
    const readerPage = await reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, session: READER_SOURCE }); // A reader persona is refused the same way: it holds no ministry membership, so no content read reaches an enumeration it could count.
    const readerRefusal = denialOf(readerPage, `readPageLocales(${PAGE_DOCUMENT}) as a reader persona`);
    expect(readerRefusal.reasonCode).toBe("not-admitted");
    expect([...readerRefusal.keys]).toEqual(["operationId", "outcome", "reasonCode"]);
    expect(denialOf(await reads.updates.readRelease({ variantId: PROTECTED_VARIANT, session: READER_SOURCE }), `readRelease(${PROTECTED_VARIANT}) as a reader persona`).reasonCode).toBe("not-admitted");
    const update = await editionsOf(UPDATE_DOCUMENT);
    const choosable = admittedLocales({ document: update.document, siteDefaultLocale: NO_DECLARED_SITE_DEFAULT, audience: "public", releases: update.editions });
    expect([choosable.map((locale) => locale.releaseId).sort(), [choosable.some((locale) => locale.releaseId === EN_SUPPORTER_RELEASE), choosable.some((locale) => locale.tag === "ar")]]).toEqual([[EN_PUBLIC_RELEASE, FR_RELEASE].sort(), [false, false]]);
    const served = resolved(resolveEdition(update, "en", "public"), "English for a public reader");
    expect(Object.keys(served).sort()).toEqual(["fallbackOccurred", "release", "requestedLocale", "servedLocale", "status"]);
    for (const expected of ["title", "editions", "count", "total"]) expect(served).not.toHaveProperty(expected);
    for (const expected of ["title", "sharePresentation"]) expect(served.release).not.toHaveProperty(expected);
    for (const expected of [SUPPORTER_TITLE, EN_SUPPORTER_RELEASE, "approved-supporter"]) expect(JSON.stringify(served)).not.toContain(expected);
  });
});
describe("a reader of published editions is given another language of the same document, Site and audience", () => {
  it("answers a language this document never published with its most recent admitted edition, naming the language actually served", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    // A reader who asks for German has no German edition. Nothing declares a Site default, so the substitute is the document's own most recently published admitted edition in that audience — the French one, published after the English — and the surface is told both tags so it can say which language it is showing.
    const resolution = resolved(resolveForReader(update, "de", "public"), "a German request over an Update that publishes English and French");
    expect([resolution.fallbackOccurred, resolution.requestedLocale, resolution.servedLocale.tag, resolution.release.releaseId, resolution.release.variantId]).toEqual([true, "de", "fr", FR_RELEASE, FR_VARIANT]);
    expect(stateOf(resolution)).toBe("fallback");
    expect(servedEditionOf(update, resolution).documentId).toBe(UPDATE_DOCUMENT);
  });
  it("keeps the substitute inside one document, one Site and one audience, exactly as the declared-default path did", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const page = await editionsOf(PAGE_DOCUMENT);
    const acrossDocuments: EditionSet = { document: update.document, editions: [...update.editions, ...page.editions] }; // One list holding every edition of both documents, which is what a substitute that walked the Site instead of the document would be handed.
    const served = resolved(resolveForReader(acrossDocuments, "de", "public"), "a German request over every edition of both documents");
    const servedRelease = servedEditionOf(acrossDocuments, served);
    expect([served.servedLocale.tag, served.release.audience, servedRelease.documentId, servedRelease.siteId]).toEqual(["fr", "public", UPDATE_DOCUMENT, HARBOUR_SITE]);
    // The French edition stamped with another Site is not this Site's substitute, so the answer is this Site's own most recent admitted edition instead.
    const french = editionOf(update, FR_VARIANT);
    const onAnotherSite: EditionSet = { document: update.document, editions: [...update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, siteId: "site-otago" } : edition)), ...page.editions] };
    expect(resolved(resolveForReader(onAnotherSite, "de", "public"), "the same request with the French edition on another Site").release.releaseId).toBe(EN_PUBLIC_RELEASE);
    // The audience is the one asked for in both directions: a protected reader is substituted inside their own audience, and a public reader is never handed the protected edition.
    const supporter = resolved(resolveForReader(update, "de", "approved-supporter"), "a German request in the approved-supporter audience");
    expect([supporter.release.releaseId, supporter.release.audience, supporter.servedLocale.tag]).toEqual([EN_SUPPORTER_RELEASE, "approved-supporter", "en"]);
    expect(resolved(resolveForReader(update, "de", "public"), "a German request in the public audience").release.releaseId).toBe(FR_RELEASE);
  });
  it("refuses a language whose own release was withdrawn rather than substituting another language for it", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const french = editionOf(update, FR_VARIANT);
    const withdrawn: EditionSet = { document: update.document, editions: update.editions.map((edition) => (edition.variantId === FR_VARIANT ? { ...french, withdrawnAt: Temporal.Instant.from("2026-11-19T09:00:00Z") } : edition)) }; // The one variable is the withdrawal: the request, the document and the editions are otherwise identical.
    const refused = unavailableResolution(resolveForReader(withdrawn, "fr", "public"), "French after its only public release was withdrawn");
    expect(refused.requestedLocale).toBe("fr");
    // A language whose edition never existed is not refused: it is answered by the document's most recent admitted edition, so the refusal follows the withdrawn language rather than the absence of a German one.
    const german = resolved(resolveForReader(withdrawn, "de", "public"), "a German request over the same editions");
    expect([german.fallbackOccurred, german.servedLocale.tag, german.release.releaseId]).toEqual([true, "en", EN_PUBLIC_RELEASE]);
  });
  it("leaves the exact policy a preview reads untouched: the same request without substitution answers Language unavailable", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    unavailableResolution(resolveEdition(update, "de", "public"), "a German request resolved exactly, as a preview resolves it");
    const substituted = resolved(resolveForReader(update, "de", "public"), "the same German request with substitution admitted");
    expect([substituted.fallbackOccurred, substituted.servedLocale.tag]).toEqual([true, "fr"]);
  });
  it("never serves a protected edition to a public audience, and names no protected edition in the answer", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const protectedOnly: EditionSet = { document: update.document, editions: update.editions.filter((edition) => edition.audience === "approved-supporter") };
    unavailableResolution(resolveForReader(protectedOnly, "de", "public"), "German for a public audience over the approved-supporter edition alone");
    const answered = resolved(resolveForReader(update, "de", "public"), "German for a public audience over both audiences' editions");
    expect([answered.release.audience, answered.release.releaseId]).toEqual(["public", FR_RELEASE]);
    for (const expected of [SUPPORTER_TITLE, EN_SUPPORTER_RELEASE, "approved-supporter"]) expect(JSON.stringify(answered)).not.toContain(expected);
  });
});
const CHOICE_BY_STATE: Readonly<Record<MembershipRecord["state"], MembershipRecord["choice"]>> = { active: "immediate", "awaiting-proof": "immediate", off: "off", restricted: "off" };
function revisionOrdinalOf(revision: string): number {
  const digits = revision.replace(/[^0-9]/gu, "");
  return digits.length === 0 ? 0 : Number.parseInt(digits, 10);
}
function membershipFrom(state: SessionStateDocument, membershipId: string): MembershipRecord {
  const stored = firstSaying(state.memberships, "membershipId", membershipId, `The seeded world holds no ${membershipId} membership, so this case cannot start from it.`);
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
const grantOf = (decision: AccessDecision): { readonly allowed: boolean; readonly reasonCode: DenialReason | null } => (decision.allowed ? { allowed: true, reasonCode: null } : { allowed: false, reasonCode: decision.denial.reasonCode });
it("a language preference is neither consent nor access: keeps the state, the Off/Immediate choice, the confirmation deadline and the language as four separate facts", async () => {
  const state = await establishedState();
  const awaitingProof = membershipFrom(state, "membership-awaiting-proof");
  expect([awaitingProof.languagePreference, awaitingProof.state, awaitingProof.choice]).toEqual(["cy", "awaiting-proof", "immediate"]);
  expect(awaitingProof.confirmationDeadline).toBeInstanceOf(Temporal.Instant);
  const active = membershipFrom(state, "membership-ada-active");
  expect([active.state, active.choice]).toEqual(["active", "immediate"]);
  const off = membershipFrom(state, "membership-unsubscribed");
  expect([off.state, off.choice]).toEqual(["off", "off"]);
  const restricted = membershipFrom(state, "membership-restricted");
  expect([restricted.state, restricted.choice]).toEqual(["restricted", "off"]);
});
it("a language preference is neither consent nor access: changes nothing but the language when the reader changes it", async () => {
  const state = await establishedState();
  const reader = sessionOf(await resolveSession(READER_SOURCE), "the reader persona's session");
  expect(reader.admittedMemberships).toEqual([]);
  const cases = [
    { membershipId: "membership-ada-active", granted: true },
    { membershipId: "membership-awaiting-proof", granted: false }, // Awaiting proof is not membership: the address has not been confirmed, so nothing is readable yet.
    { membershipId: "membership-unsubscribed", granted: true },
    { membershipId: "membership-restricted", granted: false },
  ] as const;
  expect(cases.length).toBe(4);
  for (const { membershipId, granted } of cases) {
    const record = membershipFrom(state, membershipId);
    const before = grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: { recipientId: record.recipientId, publisherId: record.publisherId, purpose: record.purpose, memberships: [record] } }));
    expect(before.allowed).toBe(granted);
    const relanguaged = withLanguagePreference(record, "ar");
    expect([[relanguaged.languagePreference, relanguaged.state, relanguaged.choice], relanguaged.confirmationDeadline, relanguaged.acceptedAt]).toEqual([["ar", record.state, record.choice], record.confirmationDeadline, record.acceptedAt]);
    expect(relanguaged.revision).toBe(record.revision + 1);
    const after = grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: { recipientId: relanguaged.recipientId, publisherId: relanguaged.publisherId, purpose: relanguaged.purpose, memberships: [relanguaged] } }));
    expect(after).toEqual(before);
  }
});
it("a language preference is neither consent nor access: does not turn a language setting into access to a protected edition", async () => {
  const reader = sessionOf(await resolveSession(READER_SOURCE), "the reader persona's session");
  const reasonCodes = new Set<string>();
  for (const requestedLocale of ["en", "ar", "fr", "cy"]) {
    const page = await reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, requestedLocale, session: READER_SOURCE });
    reasonCodes.add(denialOf(page, `readPageLocales(${PAGE_DOCUMENT}, ${requestedLocale}) as a reader persona`).reasonCode);
    const release = await reads.updates.readRelease({ variantId: "variant-update-autumn-en-approved-supporter", session: READER_SOURCE });
    reasonCodes.add(denialOf(release, `readRelease for ${requestedLocale} as a reader persona`).reasonCode);
    expect(grantOf(canReadProtected(reader, { audience: "approved-supporter", reader: null }))).toEqual({ allowed: false, reasonCode: "no-protected-grant" }); // The permission question itself takes no language at all: a protected read is decided from the grant, so a preference can neither widen nor narrow it.
  }
  expect([...reasonCodes]).toEqual(["not-admitted"]);
});
it("a language preference is neither consent nor access: never changes the audience as a side effect of resolving a language", async () => {
  const update = await editionsOf(UPDATE_DOCUMENT);
  const asPublic = resolved(resolveEdition(update, "de", "public", "en"), "German for the public audience");
  const asSupporter = resolved(resolveEdition(update, "de", "approved-supporter", "en"), "German for the approved-supporter audience");
  expect([asPublic.release.audience, asSupporter.release.audience, asPublic.release.releaseId, asSupporter.release.releaseId]).toEqual(["public", "approved-supporter", EN_PUBLIC_RELEASE, EN_SUPPORTER_RELEASE]);
  expect(asPublic.release.releaseId).not.toBe(asSupporter.release.releaseId);
});
describe("direction is content, not styling", () => {
  it("carries the direction on the edition record, with a BCP-47 language tag", async () => {
    const overview = await envelopeOf(reads.updates.readVariantOverview({ documentId: UPDATE_DOCUMENT, session: SOURCE }), `readVariantOverview(${UPDATE_DOCUMENT})`);
    expect(overview.data.editions.length).toBeGreaterThan(0); // Every tag is a BCP-47 language tag: a two- or three-letter language subtag, and nothing that would have to be guessed at.
    for (const edition of overview.data.editions) expect(edition.locale.tag).toMatch(/^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u);
    // The Arabic edition is right-to-left and the English and French ones are left-to-right, stated on the record rather than left to the reader to infer from the tag. The Arabic edition is a draft, so it is asserted on the edition record, which carries its direction before it is ever released.
    expect(overview.data.editions.find((edition) => edition.variantId === AR_VARIANT)?.locale).toEqual({ tag: "ar", direction: "rtl" });
    const update = await editionsOf(UPDATE_DOCUMENT);
    expect(editionOf(update, "variant-update-autumn-en-public").locale).toEqual({ tag: "en", direction: "ltr" });
    expect(editionOf(update, FR_VARIANT).locale).toEqual({ tag: "fr", direction: "ltr" });
    const pageRead = await envelopeOf(reads.pages.readPageLocales({ pageId: PAGE_DOCUMENT, session: SOURCE }), `readPageLocales(${PAGE_DOCUMENT})`);
    expect(pageRead.data.editions.find((edition) => edition.locale.tag === "ar")?.locale).toEqual({ tag: "ar", direction: "rtl" });
  });
  it("preserves the direction the record states instead of inferring it from the tag", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    const english = editionOf(update, "variant-update-autumn-en-public");
    // One tag, two records that differ only in the direction they state. A resolver that decided the direction from the language tag would answer the same way for both; the record is what decides.
    const statedLeftToRight: EditionSet = { document: update.document, editions: [{ ...english, locale: { tag: "ku", direction: "ltr" } }] };
    const statedRightToLeft: EditionSet = { document: update.document, editions: [{ ...english, locale: { tag: "ku", direction: "rtl" } }] };
    const leftToRight = resolved(resolveEdition(statedLeftToRight, "ku", "public"), "an edition whose record states left-to-right");
    const rightToLeft = resolved(resolveEdition(statedRightToLeft, "ku", "public"), "an edition whose record states right-to-left");
    expect(leftToRight.servedLocale).toEqual({ tag: "ku", direction: "ltr" });
    expect(rightToLeft.servedLocale).toEqual({ tag: "ku", direction: "rtl" });
    expect(resolved(resolveEdition(update, "ar", "public", "en"), "Arabic answered with the English edition").servedLocale).toEqual({ tag: "en", direction: "ltr" });
  });
  it("stores no bidi control character in the seeded Arabic content", async () => {
    for (const variantId of [AR_VARIANT, "variant-page-harbour-youth-ar-public"]) {
      const draft = await envelopeOf(reads.updates.readDraft({ variantId, session: SOURCE }), `readDraft(${variantId})`);
      if (draft.data.status !== "draft") throw new Error(`The seeded ${variantId} edition holds no draft, so its stored content cannot be inspected.`);
      const body = draft.data.revision.body;
      expect(body.direction).toBe("rtl");
      const text = JSON.stringify(body);
      expect(text).toMatch(/[\u0600-\u06FF]+/u);
      for (const codePoint of BIDI_CONTROL_CODE_POINTS) expect(text).not.toContain(String.fromCodePoint(codePoint));
      for (const section of body.sections) {
        for (const value of Object.values(section.fields)) for (const codePoint of BIDI_CONTROL_CODE_POINTS) expect(value).not.toContain(String.fromCodePoint(codePoint));
      }
    }
  });
  it("refuses an unrecognised language tag instead of resolving it to a default", async () => {
    const update = await editionsOf(UPDATE_DOCUMENT);
    expect(unavailableResolution(resolveEdition(update, "English (US)", "public"), "a language display name instead of a tag").requestedLocale).toBe("English (US)");
    const substituted = resolved(resolveEdition(update, "English (US)", "public", "en"), "a language display name with English declared"); // With a declared default the Site's edition is served, and it is reported as the substitution it is rather than as an exact match on the request.
    expect([substituted.fallbackOccurred, substituted.servedLocale.tag]).toEqual([true, "en"]);
    expect(substituted.servedLocale.tag).not.toBe(substituted.requestedLocale);
    expect(substituted.release.releaseId).toBe(EN_PUBLIC_RELEASE);
  });
  /** Every way the classification is asked. It is decided here and nowhere else: a notice rendition is stamped with this answer (content/notice.ts), so is a preview whose record states no direction (content/preview.ts), and so is a served release's own locale (data-service/reads/content.ts). A language or script missing from its tables therefore turns that content left-to-right, which no seeded record would reveal, because every seeded record states its own direction. */
  const DIRECTION_OF_TAG_CASES = [
    { shown: "Arabic, a language written right to left", tag: "ar", direction: "rtl" },
    { shown: "Hebrew, a language written right to left", tag: "he", direction: "rtl" },
    { shown: "Persian carrying a region subtag, which must not defeat the language", tag: "fa-IR", direction: "rtl" },
    { shown: "English, a language written left to right", tag: "en", direction: "ltr" },
    { shown: "Azerbaijani in Arabic script, a left-to-right language written right to left", tag: "az-Arab", direction: "rtl" },
    { shown: "Arabic in Latin script, where the script stated wins over the language", tag: "ar-Latn", direction: "ltr" },
    { shown: "A language display name no tag parser can read, which is never guessed at", tag: "English (US)", direction: "ltr" },
    { shown: "An empty tag, which is left-to-right rather than guessed", tag: "", direction: "ltr" },
    { shown: "Arabic in upper case, since the classification reads case-insensitively", tag: "AR", direction: "rtl" },
  ] as const;
  it.each(DIRECTION_OF_TAG_CASES)("classifies $shown as $direction, the direction a notice rendition and a record stating no direction are served in", ({ tag, direction }) => {
    expect(directionOfTag(tag)).toBe(direction);
  });
});
