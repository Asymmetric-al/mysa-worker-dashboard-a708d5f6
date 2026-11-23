import { Temporal } from "temporal-polyfill";
import { CONTENT_DIRECTIONS, type ContentDirection } from "@/modules/content/document";
import { isSuperseded, isWithdrawn } from "@/modules/content/reach";
import type { ContentDocument, Release, VariantAudience } from "@/modules/content/variant";
export type ContentLocale = { readonly tag: string; readonly direction: ContentDirection };
const RTL_LANGUAGES: ReadonlySet<string> = new Set<string>(["ar", "arc", "bal", "bgn", "bft", "brh", "ckb", "dv", "fa", "glk", "he", "iw", "ji", "khw", "ks", "lrc", "mzn", "nqo", "pnb", "prs", "ps", "sd", "syr", "ug", "ur", "yi"]);
const RTL_SCRIPTS: ReadonlySet<string> = new Set<string>(["adlm", "arab", "aran", "armi", "avst", "cprt", "hebr", "khar", "lydi", "mand", "mani", "mend", "merc", "mero", "narb", "nbat", "nkoo", "orkh", "palm", "phli", "phlp", "phnx", "prti", "rohg", "samr", "sarb", "sogd", "sogo", "syrc", "thaa", "yezi"]);
const LANGUAGE_SUBTAG = /^[A-Za-z]{2,3}$/u;
const REGISTERED_LANGUAGE_SUBTAG = /^[A-Za-z]{5,8}$/u;
const GENERIC_SUBTAG = /^[A-Za-z0-9]{1,8}$/u;
const SCRIPT_SUBTAG = /^[A-Za-z]{4}$/u;
const LETTER_REGION_SUBTAG = /^[A-Za-z]{2}$/u;
const DIGIT_REGION_SUBTAG = /^[0-9]{3}$/u;
type ParsedLocaleTag = { readonly tag: string; readonly language: string; readonly script?: string };
function parseLocaleTag(tag: string): ParsedLocaleTag | undefined {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return undefined;
  const subtags = trimmed.split("-");
  const language = subtags[0];
  if (language === undefined) return undefined;
  if (!LANGUAGE_SUBTAG.test(language) && !REGISTERED_LANGUAGE_SUBTAG.test(language)) return undefined;
  const normalised: string[] = [language.toLowerCase()];
  let script: string | undefined;
  for (const subtag of subtags.slice(1)) {
    if (!GENERIC_SUBTAG.test(subtag)) return undefined;
    if (normalised.length === 1 && SCRIPT_SUBTAG.test(subtag)) {
      script = subtag.toLowerCase();
      normalised.push(script.charAt(0).toUpperCase() + script.slice(1));
    } else if (LETTER_REGION_SUBTAG.test(subtag) || DIGIT_REGION_SUBTAG.test(subtag)) {
      normalised.push(subtag.toUpperCase());
    } else normalised.push(subtag.toLowerCase());
  }
  return { tag: normalised.join("-"), language: language.toLowerCase(), script };
}
const directionOfParsedTag = (parsed: ParsedLocaleTag): ContentDirection => (parsed.script !== undefined ? (RTL_SCRIPTS.has(parsed.script) ? "rtl" : "ltr") : RTL_LANGUAGES.has(parsed.language) ? "rtl" : "ltr");
/** The direction a BCP-47 tag is authored and read in: `rtl` for a language or script written right to left, and `ltr` for everything else, including a tag that cannot be read at all. */
export function directionOfTag(tag: string): ContentDirection {
  const parsed = parseLocaleTag(tag);
  return parsed === undefined ? "ltr" : directionOfParsedTag(parsed);
}
export type DocumentEdition = Release & { readonly documentId?: string; readonly siteId?: string };
type AdmittedEdition = { readonly release: DocumentEdition; readonly locale: ContentLocale; readonly parsed: ParsedLocaleTag };
export type AdmittedLocaleQuery = { readonly document: ContentDocument; readonly siteDefaultLocale: string; readonly audience: VariantAudience; readonly releases: readonly DocumentEdition[] };
export type LocaleInput = AdmittedLocaleQuery & { readonly requestedLocale: string };
export type LocaleResolution = { readonly status: "resolved"; readonly requestedLocale: string; readonly servedLocale: ContentLocale; readonly fallbackOccurred: boolean; readonly release: Release } | { readonly status: "language-unavailable"; readonly requestedLocale: string };
type StatedLocale = { readonly parsed: ParsedLocaleTag; readonly direction?: ContentDirection };
function statedLocaleOf(edition: DocumentEdition): StatedLocale | undefined {
  const locale: unknown = edition.locale;
  if (typeof locale !== "object" || locale === null) return undefined;
  const record = locale as { readonly tag?: unknown; readonly direction?: unknown };
  const parsed = typeof record.tag === "string" ? parseLocaleTag(record.tag) : undefined;
  if (parsed === undefined) return undefined;
  const direction = typeof record.direction === "string" ? CONTENT_DIRECTIONS.find((candidate) => candidate === record.direction) : undefined;
  return direction === undefined ? { parsed } : { parsed, direction };
}
const contentLocaleOf = (stated: StatedLocale): ContentLocale => ({ tag: stated.parsed.tag, direction: stated.direction ?? directionOfParsedTag(stated.parsed) });
function admittedEditions(query: AdmittedLocaleQuery): AdmittedEdition[] {
  return query.releases.flatMap((edition) => {
    const stated = statedLocaleOf(edition);
    const admitted = edition.audience === query.audience && !isWithdrawn(edition) && !isSuperseded(edition) && (edition.documentId === undefined || edition.documentId === query.document.documentId) && (edition.siteId === undefined || edition.siteId === query.document.siteId) && stated !== undefined;
    return admitted && stated !== undefined ? [{ release: edition, locale: contentLocaleOf(stated), parsed: stated.parsed }] : [];
  });
}
const compareNewestFirst = (left: AdmittedEdition, right: AdmittedEdition): number => Temporal.Instant.compare(right.release.publishedAt, left.release.publishedAt) || (left.release.releaseId === right.release.releaseId ? 0 : left.release.releaseId < right.release.releaseId ? -1 : 1);
const mostRecent = (candidates: readonly AdmittedEdition[]): AdmittedEdition | undefined => candidates.reduce<AdmittedEdition | undefined>((newest, candidate) => (newest === undefined || compareNewestFirst(candidate, newest) < 0 ? candidate : newest), undefined);
function chooseEdition(editions: readonly AdmittedEdition[], requested: ParsedLocaleTag | undefined, siteDefault: ParsedLocaleTag | undefined): AdmittedEdition | undefined {
  if (requested !== undefined) {
    const exact = mostRecent(editions.filter((edition) => edition.parsed.tag === requested.tag));
    if (exact !== undefined) return exact;
    const sameLanguage = mostRecent(editions.filter((edition) => edition.parsed.language === requested.language));
    if (sameLanguage !== undefined) return sameLanguage;
  }
  return siteDefault === undefined ? undefined : mostRecent(editions.filter((edition) => edition.parsed.tag === siteDefault.tag));
}
export function resolveLocale(input: LocaleInput): LocaleResolution {
  const requested = parseLocaleTag(input.requestedLocale);
  const served = chooseEdition(admittedEditions(input), requested, parseLocaleTag(input.siteDefaultLocale));
  if (served === undefined) return { status: "language-unavailable", requestedLocale: input.requestedLocale };
  return { status: "resolved", requestedLocale: input.requestedLocale, servedLocale: served.locale, fallbackOccurred: requested === undefined || requested.tag !== served.parsed.tag, release: served.release };
}
export type AdmittedLocale = ContentLocale & { readonly releaseId: string; readonly isSiteDefault: boolean };
/** The locales this reader may actually read, for the locale switcher and the Page edition list. */
export function admittedLocales(query: AdmittedLocaleQuery): readonly AdmittedLocale[] {
  const siteDefault = parseLocaleTag(query.siteDefaultLocale);
  const newestByTag = new Map<string, AdmittedEdition>();
  for (const edition of admittedEditions(query)) {
    const current = newestByTag.get(edition.parsed.tag);
    if (current === undefined || compareNewestFirst(edition, current) < 0) newestByTag.set(edition.parsed.tag, edition);
  }
  return [...newestByTag.values()]
    .map((edition) => ({ tag: edition.locale.tag, direction: edition.locale.direction, releaseId: edition.release.releaseId, isSiteDefault: siteDefault !== undefined && siteDefault.tag === edition.parsed.tag }))
    .sort((left, right) => {
      return left.isSiteDefault !== right.isSiteDefault ? (left.isSiteDefault ? -1 : 1) : left.tag === right.tag ? 0 : left.tag < right.tag ? -1 : 1;
    });
}
