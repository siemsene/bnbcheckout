// Student display-name rules. Mirrors cleanDisplayName/displayNameProblem in
// functions/src/index.ts, which is the authority — this copy only exists so a
// student sees the reason before the round-trip. Keep the two in step.

/** Trim, drop control and zero-width characters, collapse inner whitespace. */
export function cleanDisplayName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Why a cleaned display name is unacceptable, or null if it is fine. */
export function displayNameProblem(name: string): string | null {
  if (name.length < 2 || name.length > 20) return 'Name must be 2-20 characters.';
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} .'_-]*$/u.test(name)) {
    return "Use letters, numbers, spaces and - ' . _ only, starting with a letter or number.";
  }
  return null;
}
