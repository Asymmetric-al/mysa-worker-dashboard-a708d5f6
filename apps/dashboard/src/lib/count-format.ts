/** The whole-number formatter for the interface locale a composing route states: that locale is a viewer choice, so one formatter is built per locale and reused rather than rebuilt on every formatted count. */
const COUNT_FORMATS = new Map<string, Intl.NumberFormat>();
export function countFormatOf(locale: string): Intl.NumberFormat {
  const known = COUNT_FORMATS.get(locale) ?? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  COUNT_FORMATS.set(locale, known);
  return known;
}
