import { describe, expect, it } from "vitest";
import type { Checkout } from "./bindings/Checkout";
import { LIMIT, type Recent, withOpened } from "./recent";

const checkout = (project: string, worktree: string | null, name = "drive-web"): Checkout => ({
  name,
  project,
  worktree,
  head: { kind: "branch", name: "main" },
  commit: "c",
});

const recent = (project: string, folder: string, openedAt = 1): Recent => ({ project, name: "p", folder, openedAt });

describe("the recent projects", () => {
  it("open a project's main checkout, whatever worktree it was opened from", () => {
    const list = withOpened([], checkout("/home/me/code/drive-web/.git", "/home/me/code/drive-web/.wt/share-retry"), 5);
    expect(list).toEqual([{ project: "/home/me/code/drive-web/.git", name: "drive-web", folder: "/home/me/code/drive-web", openedAt: 5 }]);
  });

  it("open a bare project from the folder it was last opened from", () => {
    expect(withOpened([], checkout("/srv/git/tools.git", "/home/me/tools-fix"), 5)[0]?.folder).toBe("/home/me/tools-fix");
  });

  it("keep a bare project's folder when it is next shown only from its commits", () => {
    const list = withOpened([recent("/srv/git/tools.git", "/home/me/tools-fix")], checkout("/srv/git/tools.git", null), 9);
    expect(list).toEqual([{ project: "/srv/git/tools.git", name: "drive-web", folder: "/home/me/tools-fix", openedAt: 9 }]);
  });

  it("leave the list as it is for a bare project never opened from a folder", () => {
    const before = [recent("/a/.git", "/a")];
    expect(withOpened(before, checkout("/srv/git/tools.git", null), 9)).toBe(before);
  });

  it("list a project once, newest first, and at most the limit", () => {
    const before = Array.from({ length: LIMIT }, (_, i) => recent(`/p${i}/.git`, `/p${i}`));
    const list = withOpened(before, checkout("/p3/.git", "/p3"), 9);
    expect(list.map((r) => r.project)).toEqual(["/p3/.git", "/p0/.git", "/p1/.git", "/p2/.git", "/p4/.git", "/p5/.git", "/p6/.git", "/p7/.git"]);
    expect(withOpened(before, checkout("/new/.git", "/new"), 9)).toHaveLength(LIMIT);
  });
});
