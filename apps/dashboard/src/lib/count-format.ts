/** The application's default interface locale, declared once here because the formatter states it and the shell's viewer preferences default to it. */ export const DEFAULT_INTERFACE_LOCALE = "en-GB";
/** What a locale tag the runtime refuses falls back to: the digits as they stand and ungrouped, so a refused tag leaves the surface readable rather than throwing out of a render. */
const REFUSED_LOCALE_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 0, useGrouping: false });
const COUNT_FORMATS = new Map<string, Intl.NumberFormat>();
/** The whole-number formatter for the interface locale a composing route states, built once per locale rather than on every formatted count. */ export function countFormatOf(locale: string = DEFAULT_INTERFACE_LOCALE): Intl.NumberFormat {
  const cached = COUNT_FORMATS.get(locale);
  if (cached !== undefined) return cached;
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  } catch {
    format = REFUSED_LOCALE_FORMAT; // A structurally invalid tag is a RangeError here, and the count is still worth stating beside it.
  }
  COUNT_FORMATS.set(locale, format);
  return format;
}
/** One whole number as the interface locale writes it. */ export const countTextOf = (value: number, locale: string = DEFAULT_INTERFACE_LOCALE): string => countFormatOf(locale).format(value);
