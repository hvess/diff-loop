// Paths as the app shows them.

/** The last part of `path`. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder a project's main worktree is: its common git directory less a trailing `.git` (a bare one is its own). */
export function projectRoot(project: string): string {
  return project.endsWith("/.git") ? project.slice(0, -"/.git".length) : project;
}

/** `path` with `home`, when known and it holds the path, as `~`: `~/code/drive-web`. */
export function tildify(path: string, home: string | null): string {
  if (home !== null && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

/**
 * Where `worktree` is, as the window names it: inside its project's main
 * worktree, relative to it (`.wt/share-retry`); else in full (`tildify`).
 */
export function whereIs(worktree: string, project: string, home: string | null): string {
  const root = projectRoot(project);
  return worktree.startsWith(`${root}/`) ? worktree.slice(root.length + 1) : tildify(worktree, home);
}
