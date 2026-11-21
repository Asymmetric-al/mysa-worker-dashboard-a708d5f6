/** The notification notice: which single rendition an already-eligible recipient is pinned to, and what the message that points at it may say. */
import { Temporal } from "temporal-polyfill";
import { isNonEmptyString } from "@/lib/guards";
import { directionOfTag } from "@/modules/content/locale";
import { isDirectlyReadable, type ReachableEdition } from "@/modules/content/reach";
import { escapeHtml, isolateValue } from "@/modules/content/render";
import { VARIANT_AUDIENCES, type VariantAudience, type VariantLocale } from "@/modules/content/variant";
import type { MediaRenditionPurpose } from "@/modules/media/asset";
export type NoticeRecipient = { readonly recipientId: string; readonly admittedAudiences: readonly VariantAudience[]; readonly languagePreference?: string };
export type NoticeVideoPoster = { readonly releaseId: string; readonly renditionId: string; readonly purpose: MediaRenditionPurpose; readonly path: string; readonly admittedPublic: boolean; readonly release: ReachableEdition };
export interface RenditionCandidate {
  readonly variantId: string;
  readonly releaseId: string;
  readonly revisionId: string;
  readonly audience: VariantAudience;
  readonly locale: VariantLocale;
  readonly publishedAt: Temporal.Instant | string;
  readonly contentChecksum: string;
  readonly renditionId?: string;
  readonly withdrawnAt?: Temporal.Instant | string | null;
  readonly videoPoster?: NoticeVideoPoster;
}
export type PinnedRendition = { readonly variantId: string; readonly releaseId: string; readonly revisionId: string; readonly audience: VariantAudience; readonly locale: VariantLocale; readonly renditionId?: string; readonly checksum: string };
export const RENDITION_REFUSAL_REASONS = ["no-candidates", "no-readable-edition", "audience-not-admitted"] as const;
export type RenditionRefusalReason = (typeof RENDITION_REFUSAL_REASONS)[number];
export type NoticeRenditionResolution = { readonly status: "pinned"; readonly rendition: PinnedRendition; readonly videoPoster?: NoticeVideoPoster } | { readonly status: "no-eligible-rendition"; readonly reason: RenditionRefusalReason };
export type ResolveRenditionInput = { readonly recipient: NoticeRecipient; readonly candidates: readonly RenditionCandidate[]; readonly siteDefaultLocale: string };
const AUDIENCE_SPECIFICITY: Record<VariantAudience, number> = { "approved-supporter": 0, public: 1 };
const AUDIENCE_ORDER: readonly VariantAudience[] = [...VARIANT_AUDIENCES].sort((left, right) => AUDIENCE_SPECIFICITY[left] - AUDIENCE_SPECIFICITY[right]);

function identityOf(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
function instantOf(value: Temporal.Instant | string): Temporal.Instant | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return Temporal.Instant.from(trimmed);
  } catch {
    return undefined;
  }
}
const comparableTag = (value: unknown): string | undefined => identityOf(value)?.toLowerCase();
function primaryLanguage(comparable: string): string {
  const [language] = comparable.split("-");
  return language ?? comparable;
}
function isWithdrawn(candidate: RenditionCandidate): boolean {
  const withdrawnAt: unknown = candidate.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function statedTagOf(candidate: RenditionCandidate): unknown {
  const locale: unknown = candidate.locale;
  if (typeof locale !== "object" || locale === null) return undefined;
  return (locale as { readonly tag?: unknown }).tag;
}
type ReadableCandidate = { readonly candidate: RenditionCandidate; readonly tag: string; readonly language: string; readonly publishedAt: Temporal.Instant };
function readableCandidates(candidates: readonly RenditionCandidate[]): ReadableCandidate[] {
  const seenReleases = new Set<string>();
  const readable: ReadableCandidate[] = [];
  for (const candidate of candidates) {
    const releaseId = identityOf(candidate.releaseId);
    if (releaseId === undefined || identityOf(candidate.variantId) === undefined || identityOf(candidate.revisionId) === undefined || identityOf(candidate.contentChecksum) === undefined) continue;
    if (isWithdrawn(candidate) || seenReleases.has(releaseId)) continue;
    const tag = comparableTag(statedTagOf(candidate));
    const publishedAt = instantOf(candidate.publishedAt);
    if (tag === undefined || publishedAt === undefined) continue;
    seenReleases.add(releaseId);
    readable.push({ candidate, tag, language: primaryLanguage(tag), publishedAt });
  }
  return readable;
}
function comparePreference(left: ReadableCandidate, right: ReadableCandidate): number {
  const byPublication = Temporal.Instant.compare(right.publishedAt, left.publishedAt);
  if (byPublication !== 0) return byPublication;
  const byVariant = compareCodeUnits(left.candidate.variantId, right.candidate.variantId);
  if (byVariant !== 0) return byVariant;
  return compareCodeUnits(left.candidate.releaseId, right.candidate.releaseId);
}
function languageRank(entry: ReadableCandidate, preference: string | undefined, siteDefault: string | undefined): number {
  if (preference !== undefined) {
    if (entry.tag === preference) return 0;
    if (entry.language === primaryLanguage(preference)) return 1;
  }
  if (siteDefault !== undefined && entry.tag === siteDefault) return 2;
  return 3;
}
function chooseInGroup(group: readonly ReadableCandidate[], preference: string | undefined, siteDefault: string | undefined): ReadableCandidate | undefined {
  const ranked = group.map((entry) => ({ entry, rank: languageRank(entry, preference, siteDefault) })).sort((left, right) => left.rank - right.rank || comparePreference(left.entry, right.entry));
  return ranked[0]?.entry;
}
function admittedAudiencesOf(recipient: NoticeRecipient): ReadonlySet<VariantAudience> {
  const admitted = new Set<VariantAudience>();
  const stated: unknown = recipient.admittedAudiences;
  if (!Array.isArray(stated)) return admitted;
  for (const value of stated) {
    const audience = VARIANT_AUDIENCES.find((candidate) => candidate === value);
    if (audience !== undefined) admitted.add(audience);
  }
  return admitted;
}
function admittedPoster(candidate: RenditionCandidate): NoticeVideoPoster | undefined {
  if (candidate.audience !== "public") return undefined;
  const poster = candidate.videoPoster;
  if (poster === undefined || poster.purpose !== "poster" || !poster.admittedPublic) return undefined;
  if (identityOf(poster.releaseId) !== identityOf(candidate.releaseId)) return undefined;
  if (!isDirectlyReadable(poster.release)) return undefined;
  return poster;
}
/** Pins one candidate: its identity as the record a caller stores on the send and compares on a replay, or `undefined` when the candidate names no usable edition. */
export function pinRendition(candidate: RenditionCandidate): PinnedRendition | undefined {
  const variantId = identityOf(candidate.variantId);
  const releaseId = identityOf(candidate.releaseId);
  const revisionId = identityOf(candidate.revisionId);
  const checksum = identityOf(candidate.contentChecksum);
  const tag = identityOf(statedTagOf(candidate));
  const audience = VARIANT_AUDIENCES.find((value) => value === candidate.audience);
  if (variantId === undefined || releaseId === undefined || revisionId === undefined || checksum === undefined || tag === undefined || audience === undefined) return undefined;
  return { variantId, releaseId, revisionId, audience, locale: { tag, direction: directionOfTag(tag) }, renditionId: identityOf(candidate.renditionId), checksum };
}
export function resolveRendition(input: ResolveRenditionInput): NoticeRenditionResolution {
  const { recipient, candidates, siteDefaultLocale } = input;
  if (candidates.length === 0) return { status: "no-eligible-rendition", reason: "no-candidates" };
  const readable = readableCandidates(candidates);
  if (readable.length === 0) return { status: "no-eligible-rendition", reason: "no-readable-edition" };
  const admitted = admittedAudiencesOf(recipient);
  const served = readable.filter((entry) => admitted.has(entry.candidate.audience));
  if (served.length === 0) return { status: "no-eligible-rendition", reason: "audience-not-admitted" };
  const preference = comparableTag(recipient.languagePreference);
  const siteDefault = comparableTag(siteDefaultLocale);
  for (const audience of AUDIENCE_ORDER) {
    const group = served.filter((entry) => entry.candidate.audience === audience);
    if (group.length === 0) continue;
    const chosen = chooseInGroup(group, preference, siteDefault);
    if (chosen === undefined) continue;
    const rendition = pinRendition(chosen.candidate);
    if (rendition === undefined) continue;
    const videoPoster = admittedPoster(chosen.candidate);
    return videoPoster === undefined ? { status: "pinned", rendition } : { status: "pinned", rendition, videoPoster };
  }
  // Unreachable: a non-empty admitted set always has a group, and every candidate already proved the identities `pinRendition` re-checks; stated so the return is total under `noUncheckedIndexedAccess`.
  return { status: "no-eligible-rendition", reason: "no-readable-edition" };
}
export type NoticePublisher = { readonly displayName: string };
export type NoticeSender = { readonly name: string; readonly address: string };
export type NoticeInput = { readonly publisher: NoticePublisher; readonly purpose: string; readonly pinned: PinnedRendition; readonly sender: NoticeSender; readonly link: string; readonly videoPoster?: NoticeVideoPoster };
export type Notice = { readonly sender: string; readonly subject: string; readonly textBody: string; readonly htmlBody: string; readonly link: string; readonly pinned: PinnedRendition };
const NOTICE_COPY = {
  subjectLead: "New update from",
  anonymousSubject: "New update",
  publicLead: "has published an update.",
  protectedLead: "has published an update for approved supporters.",
  anonymousPublicLead: "An update has been published.",
  anonymousProtectedLead: "An update has been published for approved supporters.",
  linkLabel: "Open the update",
  noLink: "Open the application to read the update.",
  signIn: "Opening the link checks that you are signed in.",
  preferences: "You can turn these notices off in your notification preferences.",
} as const;
const PURPOSE_PHRASES: Readonly<Record<string, string>> = { "update-email": "updates by email" };
const DEFAULT_PURPOSE_PHRASE = "notices";
const NOTICE_LANGUAGE = "en";
const NOTICE_DIRECTION = "ltr";
type NoticePresenters = { readonly value: (text: string) => string; readonly link: (path: string) => string; readonly image?: (path: string) => string };
const TEXT_PRESENTERS: NoticePresenters = { value: (text) => text, link: (path) => `${NOTICE_COPY.linkLabel}: ${path}` };
const HTML_PRESENTERS: NoticePresenters = { value: isolateValue, link: (path) => `<a href="${escapeHtml(path)}">${NOTICE_COPY.linkLabel}</a>`, image: (path) => `<img src="${escapeHtml(path)}" alt="" />` };
const isControlOrSpace = (codePoint: number): boolean => codePoint <= 0x20 || codePoint === 0x7f;
function hasControlOrSpace(value: string): boolean {
  for (const character of value) if (isControlOrSpace(character.codePointAt(0) ?? 0)) return true;
  return false;
}
function singleLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let flattened = "";
  for (const character of value) flattened += isControlOrSpace(character.codePointAt(0) ?? 0) ? " " : character;
  const collapsed = flattened.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? undefined : collapsed;
}
function addressOf(value: unknown): string | undefined {
  const address = singleLine(value);
  if (address === undefined) return undefined;
  if (address.includes("<") || address.includes(">") || address.includes(",")) return undefined;
  if (address.includes(";")) return undefined;
  const at = address.indexOf("@");
  if (at < 1 || at === address.length - 1) return undefined;
  return address.indexOf("@", at + 1) === -1 ? address : undefined;
}
function senderLineOf(sender: NoticeSender): string {
  const stated: unknown = sender;
  if (typeof stated !== "object" || stated === null) return "";
  const record = stated as { readonly name?: unknown; readonly address?: unknown };
  const name = singleLine(record.name);
  const address = addressOf(record.address);
  if (name !== undefined && address !== undefined) return `${name} <${address}>`;
  return address ?? name ?? "";
}
function publisherNameOf(publisher: NoticePublisher): string | undefined {
  const stated: unknown = publisher;
  if (typeof stated !== "object" || stated === null) return undefined;
  return singleLine((stated as { readonly displayName?: unknown }).displayName);
}
function purposePhraseOf(purpose: unknown): string {
  const key = singleLine(purpose)?.toLowerCase();
  if (key === undefined) return DEFAULT_PURPOSE_PHRASE;
  return PURPOSE_PHRASES[key] ?? DEFAULT_PURPOSE_PHRASE;
}
function sameOriginPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  if (trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("\\")) return undefined;
  return hasControlOrSpace(trimmed) ? undefined : trimmed;
}
function posterPathOf(pinned: PinnedRendition, poster: NoticeVideoPoster | undefined): string | undefined {
  if (poster === undefined || pinned.audience !== "public") return undefined;
  if (poster.purpose !== "poster" || !poster.admittedPublic) return undefined;
  if (identityOf(poster.releaseId) !== identityOf(pinned.releaseId)) return undefined;
  if (!isDirectlyReadable(poster.release)) return undefined;
  return sameOriginPath(poster.path);
}
const subjectOf = (publisher: string | undefined): string => (publisher === undefined ? NOTICE_COPY.anonymousSubject : `${NOTICE_COPY.subjectLead} ${publisher}`);
function composeParagraphs(input: { readonly publisher: string | undefined; readonly phrase: string; readonly link: string | undefined; readonly posterPath: string | undefined; readonly protectedCopy: boolean; readonly presenters: NoticePresenters }): readonly string[] {
  const { publisher, phrase, link, posterPath, protectedCopy, presenters } = input;
  const lead = protectedCopy ? NOTICE_COPY.protectedLead : NOTICE_COPY.publicLead;
  const anonymousLead = protectedCopy ? NOTICE_COPY.anonymousProtectedLead : NOTICE_COPY.anonymousPublicLead;
  const headline = publisher === undefined ? anonymousLead : `${presenters.value(publisher)} ${lead}`;
  const reason = publisher === undefined ? `You are receiving ${phrase} because you asked to hear from this publisher.` : `You are receiving ${phrase} from ${presenters.value(publisher)} because you asked to ` + "hear from them.";
  const paragraphs: string[] = [headline, link === undefined ? NOTICE_COPY.noLink : presenters.link(link)];
  if (posterPath !== undefined && presenters.image !== undefined) paragraphs.push(presenters.image(posterPath));
  paragraphs.push(`${protectedCopy ? `${NOTICE_COPY.signIn} ` : ""}${reason} ${NOTICE_COPY.preferences}`);
  return paragraphs;
}
/** Builds the notice one recipient receives for the copy they were pinned to: a sender, a generic subject, and the same short wording in plain text and in HTML, pointing at the receiving route. */
export function buildNotice(input: NoticeInput): Notice {
  const pinned = input.pinned;
  const publisher = publisherNameOf(input.publisher);
  const phrase = purposePhraseOf(input.purpose);
  const link = sameOriginPath(input.link);
  const posterPath = posterPathOf(pinned, input.videoPoster);
  const protectedCopy = pinned.audience === "approved-supporter";
  const shared = { publisher, phrase, link, posterPath, protectedCopy };
  const htmlParagraphs = composeParagraphs({ ...shared, presenters: HTML_PRESENTERS })
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("\n");
  return { sender: senderLineOf(input.sender), subject: subjectOf(publisher), textBody: composeParagraphs({ ...shared, presenters: TEXT_PRESENTERS }).join("\n\n"), htmlBody: `<div lang="${NOTICE_LANGUAGE}" dir="${NOTICE_DIRECTION}">\n${htmlParagraphs}\n</div>`, link: link ?? "", pinned };
}
