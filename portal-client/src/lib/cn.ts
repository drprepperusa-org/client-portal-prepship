export type ClassValue = string | number | false | null | undefined;

/** Tiny classnames joiner (no external dep). */
export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
