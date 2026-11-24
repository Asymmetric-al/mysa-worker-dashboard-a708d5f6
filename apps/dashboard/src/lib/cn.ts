import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/** Merges class values into one class string where the last conflicting Tailwind utility wins. */ export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
