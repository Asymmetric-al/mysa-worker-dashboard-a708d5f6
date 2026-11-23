/** One whole number as the locale writes it, falling back to the plain digits when the runtime refuses the locale tag rather than failing the surface that states it. */ export function countText(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
