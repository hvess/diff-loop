// The macOS menu bar (diff-loop-app.md Decision 18). Item names are title case, per the HIG's `menus` page.
import { CheckMenuItem, Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";
import { chooseFolder } from "./choose";
import { dialogOpen } from "./platform";
import { useStore } from "./store";

type Store = ReturnType<typeof useStore.getState>;

/** What the menu bar shows of the store; it is updated only where this changes. */
export type MenuState = {
  open: boolean;
  unified: boolean;
  /** Whether the selected file is viewed; null without one. */
  viewed: boolean | null;
  hasComments: boolean;
  /** Whether lines are selected to comment on, with no comment being written. */
  canComment: boolean;
  /** Whether find in file is open. */
  finding: boolean;
};

export function menuState(s: Store): MenuState {
  const selected = s.selected !== null && s.review?.byPath.has(s.selected) ? s.selected : null;
  return {
    open: s.review !== null,
    unified: s.mode === "unified",
    viewed: selected === null ? null : s.viewed.has(selected),
    hasComments: s.comments.some((c) => c.state === "current"),
    canComment: s.selection !== null && s.composer === null,
    finding: s.find !== null,
  };
}

/** Installs the menu bar; the returned function stops following the store. */
export async function installMenuBar(): Promise<() => void> {
  const act = (action: (s: Store) => void) => () => {
    action(useStore.getState());
    void apply(menuState(useStore.getState()));
  };
  const unified = await CheckMenuItem.new({ text: "Unified", action: act((s) => s.setMode("unified")) });
  const split = await CheckMenuItem.new({ text: "Split", action: act((s) => s.setMode("split")) });
  const viewed = await CheckMenuItem.new({ text: "Viewed", action: act((s) => s.toggleViewed()) });
  const next = await MenuItem.new({ text: "Next Comment", action: act((s) => s.jumpComment(1)) });
  const previous = await MenuItem.new({ text: "Previous Comment", action: act((s) => s.jumpComment(-1)) });
  const comment = await MenuItem.new({ text: "Comment on Selection…", action: act((s) => s.composeOnSelection()) });
  const find = await MenuItem.new({
    text: "Find…",
    accelerator: "CmdOrCtrl+F",
    action: act((s) => {
      if (!dialogOpen()) s.openFind();
    }),
  });
  // Held back under a dialog, as ⌘G is in the window (diff-loop-app.md Decision 29).
  const findNext = await MenuItem.new({
    text: "Find Next",
    accelerator: "CmdOrCtrl+G",
    action: act((s) => {
      if (!dialogOpen()) s.stepFind(1);
    }),
  });
  const findPrevious = await MenuItem.new({
    text: "Find Previous",
    accelerator: "CmdOrCtrl+Shift+G",
    action: act((s) => {
      if (!dialogOpen()) s.stepFind(-1);
    }),
  });
  const windowMenu = await Submenu.new({
    text: "Window",
    items: [{ item: "Minimize" }, { item: "Maximize", text: "Zoom" }, { item: "Separator" }, { item: "BringAllToFront" }],
  });
  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: "Diff Loop",
        items: [
          { item: { About: { name: "Diff Loop" } }, text: "About Diff Loop" },
          { item: "Separator" },
          { item: "Services" },
          { item: "Separator" },
          { item: "Hide", text: "Hide Diff Loop" },
          { item: "HideOthers" },
          { item: "ShowAll" },
          { item: "Separator" },
          { item: "Quit", text: "Quit Diff Loop" },
        ],
      }),
      await Submenu.new({
        text: "File",
        items: [
          { text: "Open Folder…", accelerator: "CmdOrCtrl+O", action: () => void chooseFolder() },
          { item: "Separator" },
          { item: "CloseWindow" },
        ],
      }),
      await Submenu.new({
        text: "Edit",
        items: [
          { item: "Undo" },
          { item: "Redo" },
          { item: "Separator" },
          { item: "Cut" },
          { item: "Copy" },
          { item: "Paste" },
          { item: "SelectAll" },
          { item: "Separator" },
          find,
          findNext,
          findPrevious,
        ],
      }),
      await Submenu.new({ text: "View", items: [unified, split, { item: "Separator" }, { item: "Fullscreen", text: "Enter Full Screen" }] }),
      await Submenu.new({ text: "Review", items: [comment, { item: "Separator" }, next, previous, { item: "Separator" }, viewed] }),
      windowMenu,
    ],
  });
  await menu.setAsAppMenu();
  await windowMenu.setAsWindowsMenuForNSApp();

  /** Every item's state; a chosen check item has flipped itself, so all are set, not only what changed. */
  function apply(now: MenuState): Promise<unknown> {
    return Promise.all([
      unified.setEnabled(now.open),
      split.setEnabled(now.open),
      find.setEnabled(now.open),
      findNext.setEnabled(now.finding),
      findPrevious.setEnabled(now.finding),
      unified.setChecked(now.unified),
      split.setChecked(!now.unified),
      viewed.setEnabled(now.viewed !== null),
      viewed.setChecked(now.viewed === true),
      next.setEnabled(now.hasComments),
      previous.setEnabled(now.hasComments),
      comment.setEnabled(now.canComment),
    ]);
  }

  let last = menuState(useStore.getState());
  await apply(last);
  return useStore.subscribe((s) => {
    const now = menuState(s);
    if (sameMenuState(now, last)) return;
    last = now;
    void apply(now);
  });
}

export function sameMenuState(a: MenuState, b: MenuState): boolean {
  return (
    a.open === b.open &&
    a.unified === b.unified &&
    a.viewed === b.viewed &&
    a.hasComments === b.hasComments &&
    a.canComment === b.canComment &&
    a.finding === b.finding
  );
}
