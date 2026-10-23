// How typed text matches what a list shows, in Filter Files, the review switcher and the base picker alike.

/** `text` without case or diacritics, so "resume" finds "Résumé" (diff-loop-app.md Decision 35). */
export function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
