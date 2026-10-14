// Paths as the app shows them.

/** The last part of `path`. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
