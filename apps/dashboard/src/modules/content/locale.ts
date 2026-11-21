/**
 * Locale fallback: the one implementation that decides which locale edition of a document a reader is
 * served, whether serving it was a fallback, and when the honest answer is *Language unavailable*.
 *
 * Plan items that put this file in scope:
 * - AAP 0.6.1 "Content module" row: the key interface `resolveLocale()`, under the responsibility
 *   "locale fallback".
 * - AAP 0.3.4 row "Locale fallback resolution": the single implementation, consumed by the Page
 *   editions, the Update variants, the receiving preview, message rendering and metadata.
 * - AAP 0.8.6: "Locale fallback resolves within the same document, Site and selected audience using
 *   currently admitted releases only; the actual language is shown when fallback occurs; with no
 *   permitted fallback the surface shows *Language unavailable*; fallback never changes the audience
 *   and never exposes a denied variant's existence or title."
 * - AAP 0.8.5: "A reader's language choice is separate from Off/Immediate and from proof of email
 *   possession".
 * - Acceptance criterion 17, proven by `tests/domain/locale-fallback.test.ts` and
 *   `e2e/variants-and-rtl.spec.ts`.
 *
 * The resolution order is fixed, and it is the whole of this module:
 *
 * 1. an exact BCP-47 tag match with an admitted release of this document, this Site and this audience;
 * 2. the same primary language subtag within that same document, Site and audience — so a request for
 *    `fr-CA` is served the `fr-FR` edition rather than nothing — taking the most recently published
 *    admitted release when several match, so the answer never depends on the order of an array;
 * 3. the Site's declared default locale edition, when it is admitted for this audience;
 * 4. otherwise `language-unavailable`, carrying the requested language and nothing else.
 *
 * `fallbackOccurred` is true exactly when the served edition is not the requested one. Tags compare
 * case-insensitively, so `EN-gb` asked of an `en-GB` edition is that edition and not a fallback.
 *
 * Admitted means released and not withdrawn. Admission is read from the release records this module is
 * handed: a release carries its own audience and exact locale, and the head of a variant is the
 * release carrying neither a withdrawal nor a supersession. A draft, a candidate, a superseded head
 * and a withdrawn edition are therefore never served — not because a caller is trusted to filter them,
 * but because this module refuses them.
 *
 * A denied edition is invisible. When the requested language exists only for an audience the reader is
 * not admitted to, the answer is the same `language-unavailable` result as a language that exists
 * nowhere: no `denied` flag, no hint field, no title, no count, no sibling-language list beyond the
 * editions `admittedLocales` legitimately names, and no wording by which a caller could tell the two
 * apart. The result type enforces the last of those: the unavailable result carries `status` and
 * `requestedLocale` and no other key.
 *
 * The audience arrives as an already-authorised fact and is never inferred here. This module reads no
 * membership, consent, email, preference or coaching-grant state, and it neither widens nor narrows
 * the audience. A reader's language choice can therefore only change which admitted edition they are
 * served: it is neither consent nor proof of email possession, so nothing here subscribes,
 * unsubscribes, confirms a membership or touches a notification intent.
 *
 * Direction travels with the locale. `ContentLocale` carries the direction the edition is authored and
 * read in, so the served edition's direction reaches `render.ts` and the components; this module never
 * sets a CSS base direction, never alters text and never stores a directional mark.
 *
 * Reach is not admission, so this module deliberately does not consult `reach.ts`. Reach decides
 * whether a public route serves an edition — the discovery index, the direct link, the `noindex`
 * directive — once the reader's audience is established, and a `not-public` release is still a
 * legitimate edition for its audience. Filtering on reach here would answer *Language unavailable* for
 * an edition the reader may read.
 *
 * Pure and deterministic: the same input yields the same result. The clock is not read (translation
 * staleness is `variant.ts`'s), nothing is random, nothing is cached, no locale-aware formatting API
 * is used, and the module holds no mutable state.
 *
 * Layering: a framework-free domain module, importable from either side of the data service. It
 * imports the content profile's direction vocabulary, the variant and release records, and the
 * `Instant` comparison of `temporal-polyfill` — nothing else. It reaches no store, no data service, no
 * audience module, no media module, no component, no feature and no framework, which is what lets
 * `modules/audience` import this module without a cycle.
 */
import { Temporal } from "temporal-polyfill";

import { CONTENT_DIRECTIONS, type ContentDirection } from "@/modules/content/document";
import type { ContentDocument, Release, VariantAudience } from "@/modules/content/variant";

// ---------------------------------------------------------------------------------------------
// The exact content locale: one tag and the direction it is read in
// ---------------------------------------------------------------------------------------------

/**
 * One exact content locale as a reader is served it: the edition's BCP-47 tag and the direction the
 * edition is authored and read in.
 *
 * It satisfies `VariantLocale` field for field, which is what lets the served edition's locale travel
 * back into a variant key without a conversion, and it is the only shape `resolveLocale` puts on a
 * served edition. The tag is stated in normalised form — language lowercased, script in title case,
 * region uppercased — because case carries no meaning in BCP-47, so a link, a label and a comparison
 * built from this value agree with each other.
 */
export interface ContentLocale {
  /** The BCP-47 tag of the edition, normalised. */
  readonly tag: string;
  /** The direction the edition is authored and read in. */
  readonly direction: ContentDirection;
}

/**
 * The primary language subtags a language is written right to left in, lowercased.
 *
 * It is a vocabulary of languages rather than of locales: a tag that states a script subtag is
 * answered by the script first, so `az-Arab` reads right to left while plain `az` does not. A
 * language the list does not name reads left to right rather than being guessed at.
 */
const RTL_LANGUAGES: ReadonlySet<string> = new Set<string>([
  "ar",
  "arc",
  "bal",
  "bgn",
  "bft",
  "brh",
  "ckb",
  "dv",
  "fa",
  "glk",
  "he",
  "iw",
  "ji",
  "khw",
  "ks",
  "lrc",
  "mzn",
  "nqo",
  "pnb",
  "prs",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

/**
 * The four-letter script subtags written right to left, lowercased.
 *
 * A stated script answers before the language does, because one language is written in more than one
 * direction: `ku-Latn` reads left to right, `ku-Arab` right to left.
 */
const RTL_SCRIPTS: ReadonlySet<string> = new Set<string>([
  "adlm",
  "arab",
  "aran",
  "armi",
  "avst",
  "cprt",
  "hebr",
  "khar",
  "lydi",
  "mand",
  "mani",
  "mend",
  "merc",
  "mero",
  "narb",
  "nbat",
  "nkoo",
  "orkh",
  "palm",
  "phli",
  "phlp",
  "phnx",
  "prti",
  "rohg",
  "samr",
  "sarb",
  "sogd",
  "sogo",
  "syrc",
  "thaa",
  "yezi",
]);

/** A language subtag: an ISO 639 two- or three-letter code. */
const LANGUAGE_SUBTAG = /^[A-Za-z]{2,3}$/u;

/** A registered language subtag: the five- to eight-letter range RFC 5646 reserves for them. */
const REGISTERED_LANGUAGE_SUBTAG = /^[A-Za-z]{5,8}$/u;

/** Any other subtag a tag may state: one to eight alphanumeric characters. */
const GENERIC_SUBTAG = /^[A-Za-z0-9]{1,8}$/u;

/** A script subtag: four letters, in the position immediately after the language. */
const SCRIPT_SUBTAG = /^[A-Za-z]{4}$/u;

/** A region subtag written as letters, as in `CA` or `GB`. */
const LETTER_REGION_SUBTAG = /^[A-Za-z]{2}$/u;

/** A region subtag written as digits, as in `419`. */
const DIGIT_REGION_SUBTAG = /^[0-9]{3}$/u;

/**
 * A tag this module could read, in the normalised form it compares tags by: the language lowercased,
 * a script subtag in title case, a region uppercased and every other subtag lowercased.
 */
interface ParsedLocaleTag {
  /** The tag in normalised form, so two spellings of one locale compare equal. */
  readonly tag: string;
  /** The primary language subtag, lowercased, which step 2 of the chain matches on. */
  readonly language: string;
  /** The script subtag, lowercased, when the tag states one. */
  readonly script?: string;
}

/**
 * Reads a BCP-47 tag into the form this module compares by, or answers `undefined` when the tag is
 * not one.
 *
 * The parse is shape-only and repairs nothing: a blank tag, an empty subtag, a subtag longer than
 * eight characters and a tag whose first subtag is not a two- or three-letter language code (or a
 * registered five- to eight-letter one) are all unreadable, and an unreadable tag therefore falls
 * through the whole chain instead of being coerced into a near match. Case is not meaning in BCP-47,
 * which is why normalising it is not a repair: `fr-ca`, `FR-CA` and `fr-CA` are one locale.
 */
function parseLocaleTag(tag: string): ParsedLocaleTag | undefined {
  const trimmed = tag.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const subtags = trimmed.split("-");
  const language = subtags[0];
  if (language === undefined) {
    return undefined;
  }
  if (!LANGUAGE_SUBTAG.test(language) && !REGISTERED_LANGUAGE_SUBTAG.test(language)) {
    return undefined;
  }
  const normalised: string[] = [language.toLowerCase()];
  let script: string | undefined;
  for (const subtag of subtags.slice(1)) {
    if (!GENERIC_SUBTAG.test(subtag)) {
      return undefined;
    }
    // A script subtag is the one that directly follows the language; a four-letter subtag after a
    // region or a variant is a variant subtag, not a script, so it states no direction.
    if (normalised.length === 1 && SCRIPT_SUBTAG.test(subtag)) {
      script = subtag.toLowerCase();
      normalised.push(script.charAt(0).toUpperCase() + script.slice(1));
    } else if (LETTER_REGION_SUBTAG.test(subtag) || DIGIT_REGION_SUBTAG.test(subtag)) {
      normalised.push(subtag.toUpperCase());
    } else {
      normalised.push(subtag.toLowerCase());
    }
  }
  return { tag: normalised.join("-"), language: language.toLowerCase(), script };
}

/** The direction a parsed tag is authored and read in: its script when stated, else its language. */
function directionOfParsedTag(parsed: ParsedLocaleTag): ContentDirection {
  if (parsed.script !== undefined) {
    return RTL_SCRIPTS.has(parsed.script) ? "rtl" : "ltr";
  }
  return RTL_LANGUAGES.has(parsed.language) ? "rtl" : "ltr";
}

/**
 * The direction a BCP-47 tag is authored and read in: `rtl` for a language or script written right to
 * left, and `ltr` for everything else, including a tag that cannot be read at all.
 *
 * It is the one answer to "which way does this language read", used when an edition states its
 * direction and by a caller composing a new edition's `VariantLocale` from a tag alone. A tag it
 * cannot read states no direction it can be trusted for, and `ltr` is the answer that changes no text.
 */
export function directionOfTag(tag: string): ContentDirection {
  const parsed = parseLocaleTag(tag);
  return parsed === undefined ? "ltr" : directionOfParsedTag(parsed);
}

// ---------------------------------------------------------------------------------------------
// The editions this module resolves over: admitted releases of one document, Site and audience
// ---------------------------------------------------------------------------------------------

/**
 * A release as a caller hands it in, optionally stating the document and Site it belongs to.
 *
 * A `Release` names the variant it publishes and carries its own audience, exact locale, reach and
 * withdrawal; the document is the variant's. A caller that holds that identity — the service
 * resolving one document's editions does — states it here, and this module then enforces the
 * same-document and same-Site rule of AAP 0.8.6 rather than assuming the caller scoped correctly.
 * When the fields are absent, the releases passed are taken as already scoped, and the audience, the
 * withdrawal, the supersession and the tag are still checked.
 */
export interface DocumentEdition extends Release {
  /** The canonical document the edition publishes, when the caller states it. */
  readonly documentId?: string;
  /** The Site the edition belongs to, when the caller states it. */
  readonly siteId?: string;
}

/** One release this reader is admitted to, with the locale it serves and the tag the chain matches. */
interface AdmittedEdition {
  /** The release record itself, which a resolution hands back unchanged. */
  readonly release: DocumentEdition;
  /** The tag and direction this edition serves. */
  readonly locale: ContentLocale;
  /** The tag in the form the chain compares by. */
  readonly parsed: ParsedLocaleTag;
}

/** The scope every read of this module states: which document, which Site default, which audience. */
export interface AdmittedLocaleQuery {
  /** The canonical document whose editions are resolved; its identity and Site scope the releases. */
  readonly document: ContentDocument;
  /** The BCP-47 tag of the Site's declared default edition, or a blank string when it declares none. */
  readonly siteDefaultLocale: string;
  /** The audience the reader is already admitted to; this module never widens or narrows it. */
  readonly audience: VariantAudience;
  /** The release records the caller resolved for this document, in any order. */
  readonly releases: readonly DocumentEdition[];
}

/** One resolution: the scope a reader is reading in, plus the language they asked for. */
export interface LocaleInput extends AdmittedLocaleQuery {
  /** The BCP-47 tag the reader asked for, which need not be the one they are served. */
  readonly requestedLocale: string;
}

/**
 * What a reader is served for the language they asked for, and nothing else.
 *
 * `resolved` names the admitted edition — its release, its tag and its direction — and
 * `fallbackOccurred`, which is true exactly when the served edition is not the requested one, so a
 * surface can state the actual language it is showing rather than implying the request was met.
 *
 * `language-unavailable` carries the requested language and no other fact: no title, no count, no
 * sibling edition and no hint that an edition for another audience exists. A language served only to
 * an audience this reader is not admitted to is therefore indistinguishable from a language with no
 * edition at all, which is the point rather than an omission.
 */
export type LocaleResolution =
  | {
      /** An admitted edition serves this reader. */
      readonly status: "resolved";
      /** The language the reader asked for, stated as it was asked. */
      readonly requestedLocale: string;
      /** The edition actually served, with the direction it is read in. */
      readonly servedLocale: ContentLocale;
      /** Whether the served edition is a different language from the one requested. */
      readonly fallbackOccurred: boolean;
      /** The release record that serves it, unchanged. */
      readonly release: Release;
    }
  | {
      /** No edition this reader is admitted to exists in the requested language. */
      readonly status: "language-unavailable";
      /** The language the reader asked for, and no other fact. */
      readonly requestedLocale: string;
    };

// ---------------------------------------------------------------------------------------------
// Admission: which releases this reader may be served, and in which order they are ranked
// ---------------------------------------------------------------------------------------------

/**
 * Whether an edition has been withdrawn, in whichever form a stored record states the instant:
 * absent means it still serves, and a present instant or a stored `null` means it does not.
 */
function isWithdrawn(edition: DocumentEdition): boolean {
  const withdrawnAt: unknown = edition.withdrawnAt;
  return withdrawnAt !== undefined && withdrawnAt !== null;
}

/**
 * Whether an edition has been replaced as its variant's head. A supersession names the release that
 * replaced it, so a stored blank value states no supersession and the edition is still the head.
 */
function isSuperseded(edition: DocumentEdition): boolean {
  const supersededBy: unknown = edition.supersededBy;
  return typeof supersededBy === "string" && supersededBy.trim().length > 0;
}

/**
 * The locale an edition record states, read defensively: a record read back from JSON can lose a
 * field or carry a direction this profile does not have, and neither is a reason to fail a read.
 * An edition that states no readable tag names no edition and is refused; a direction outside the
 * profile's two values is ignored in favour of the one its tag implies.
 */
interface StatedLocale {
  /** The tag in the form the chain compares by. */
  readonly parsed: ParsedLocaleTag;
  /** The direction the record states, when it states one this profile has. */
  readonly direction?: ContentDirection;
}

/** Reads the locale one release record states, or `undefined` when it states no readable tag. */
function statedLocaleOf(edition: DocumentEdition): StatedLocale | undefined {
  const locale: unknown = edition.locale;
  if (typeof locale !== "object" || locale === null) {
    return undefined;
  }
  const record = locale as { readonly tag?: unknown; readonly direction?: unknown };
  if (typeof record.tag !== "string") {
    return undefined;
  }
  const parsed = parseLocaleTag(record.tag);
  if (parsed === undefined) {
    return undefined;
  }
  const direction =
    typeof record.direction === "string"
      ? CONTENT_DIRECTIONS.find((candidate) => candidate === record.direction)
      : undefined;
  return direction === undefined ? { parsed } : { parsed, direction };
}

/** The locale one admitted release serves: its normalised tag and the direction it is read in. */
function contentLocaleOf(stated: StatedLocale): ContentLocale {
  return {
    tag: stated.parsed.tag,
    direction: stated.direction ?? directionOfParsedTag(stated.parsed),
  };
}

/**
 * The releases this reader is admitted to, in the order they were handed in.
 *
 * A release qualifies when it serves this audience, has been neither withdrawn nor superseded,
 * belongs to this document and Site when it states them, and carries a tag this module can read.
 * Every other release is refused here rather than filtered by a caller, which is what makes admission
 * a property of this module: another audience's edition is not this reader's edition, and a release
 * whose tag cannot be read names no edition at all.
 */
function admittedEditions(query: AdmittedLocaleQuery): AdmittedEdition[] {
  const admitted: AdmittedEdition[] = [];
  for (const edition of query.releases) {
    if (edition.audience !== query.audience) {
      continue;
    }
    if (isWithdrawn(edition) || isSuperseded(edition)) {
      continue;
    }
    if (edition.documentId !== undefined && edition.documentId !== query.document.documentId) {
      continue;
    }
    if (edition.siteId !== undefined && edition.siteId !== query.document.siteId) {
      continue;
    }
    const stated = statedLocaleOf(edition);
    if (stated === undefined) {
      continue;
    }
    admitted.push({ release: edition, locale: contentLocaleOf(stated), parsed: stated.parsed });
  }
  return admitted;
}

/**
 * Orders two admitted editions newest first: by publication instant, and by release identity when two
 * publications share one instant.
 *
 * Publication order is the tie-break the same-language step of the chain uses, so one language is
 * answered by one edition however the releases arrived. The residual identity comparison makes the
 * order total, so even two editions published at the same scenario instant resolve the same way
 * every time.
 */
function compareNewestFirst(left: AdmittedEdition, right: AdmittedEdition): number {
  const byPublication = Temporal.Instant.compare(
    right.release.publishedAt,
    left.release.publishedAt,
  );
  if (byPublication !== 0) {
    return byPublication;
  }
  if (left.release.releaseId === right.release.releaseId) {
    return 0;
  }
  return left.release.releaseId < right.release.releaseId ? -1 : 1;
}

/** The newest edition among the candidates, or `undefined` when there are none. */
function mostRecent(candidates: readonly AdmittedEdition[]): AdmittedEdition | undefined {
  let newest: AdmittedEdition | undefined;
  for (const candidate of candidates) {
    if (newest === undefined || compareNewestFirst(candidate, newest) < 0) {
      newest = candidate;
    }
  }
  return newest;
}

/**
 * The edition the fixed chain serves, or `undefined` when it reaches its last step.
 *
 * The steps are the module's contract and are not configurable: exact tag, then the same primary
 * language, then the Site's declared default edition, then nothing. An unreadable requested tag skips
 * the first two steps, because a tag this module cannot read matches no edition — and a Site that
 * declares no default, or declares one no admitted release serves, ends the chain.
 */
function chooseEdition(
  editions: readonly AdmittedEdition[],
  requested: ParsedLocaleTag | undefined,
  siteDefault: ParsedLocaleTag | undefined,
): AdmittedEdition | undefined {
  if (requested !== undefined) {
    const exact = mostRecent(editions.filter((edition) => edition.parsed.tag === requested.tag));
    if (exact !== undefined) {
      return exact;
    }
    const sameLanguage = mostRecent(
      editions.filter((edition) => edition.parsed.language === requested.language),
    );
    if (sameLanguage !== undefined) {
      return sameLanguage;
    }
  }
  if (siteDefault === undefined) {
    return undefined;
  }
  return mostRecent(editions.filter((edition) => edition.parsed.tag === siteDefault.tag));
}

/**
 * Resolves the edition a reader is served for the language they asked for.
 *
 * `resolved` carries the admitted edition — its release record, the tag it serves and the direction it
 * is read in — and `fallbackOccurred`, true exactly when that edition is not the one requested.
 * `language-unavailable` carries the requested language and nothing else, so a language served only to
 * another audience is answered exactly as a language with no edition anywhere.
 *
 * Nothing here reads a clock, infers an audience, counts an edition, caches an answer or changes
 * state: the result is a function of the input alone.
 */
export function resolveLocale(input: LocaleInput): LocaleResolution {
  const requested = parseLocaleTag(input.requestedLocale);
  const served = chooseEdition(
    admittedEditions(input),
    requested,
    parseLocaleTag(input.siteDefaultLocale),
  );
  if (served === undefined) {
    return { status: "language-unavailable", requestedLocale: input.requestedLocale };
  }
  return {
    status: "resolved",
    requestedLocale: input.requestedLocale,
    servedLocale: served.locale,
    fallbackOccurred: requested === undefined || requested.tag !== served.parsed.tag,
    release: served.release,
  };
}

// ---------------------------------------------------------------------------------------------
// The locales a reader may choose
// ---------------------------------------------------------------------------------------------

/**
 * One locale a reader may choose, as a locale switcher lists it: the tag and direction that would be
 * served, the release that serves it, and whether it is the Site's declared default.
 *
 * It names no title, no status and no other audience's edition: a locale appears here only because an
 * admitted release serves it to this reader.
 */
export interface AdmittedLocale extends ContentLocale {
  /** The release that serves this locale to this audience, so a caller can address it exactly. */
  readonly releaseId: string;
  /** Whether this locale is the Site's declared default edition, which a switcher lists first. */
  readonly isSiteDefault: boolean;
}

/**
 * The locales this reader may actually read, for the locale switcher and the Page edition list.
 *
 * Every entry is an admitted release: a locale whose only edition is withdrawn, superseded or served
 * to another audience is absent rather than listed and then refused. One entry per locale, taking the
 * newest release when a locale is somehow released twice; the Site's default locale first and the
 * rest in tag order, so one input always lists the same locales in the same order.
 */
export function admittedLocales(query: AdmittedLocaleQuery): readonly AdmittedLocale[] {
  const siteDefault = parseLocaleTag(query.siteDefaultLocale);
  const newestByTag = new Map<string, AdmittedEdition>();
  for (const edition of admittedEditions(query)) {
    const current = newestByTag.get(edition.parsed.tag);
    if (current === undefined || compareNewestFirst(edition, current) < 0) {
      newestByTag.set(edition.parsed.tag, edition);
    }
  }
  const locales = [...newestByTag.values()].map((edition) => ({
    tag: edition.locale.tag,
    direction: edition.locale.direction,
    releaseId: edition.release.releaseId,
    isSiteDefault: siteDefault !== undefined && siteDefault.tag === edition.parsed.tag,
  }));
  return locales.sort((left, right) => {
    if (left.isSiteDefault !== right.isSiteDefault) {
      return left.isSiteDefault ? -1 : 1;
    }
    if (left.tag === right.tag) {
      return 0;
    }
    return left.tag < right.tag ? -1 : 1;
  });
}

