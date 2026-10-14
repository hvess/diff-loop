// Native context menus in place of the webview's (diff-loop-app.md Decision 19).
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, type CheckMenuItemOptions, type MenuItemOptions, type PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import { typing } from "./platform";

type MenuEntry = MenuItemOptions | CheckMenuItemOptions | PredefinedMenuItemOptions;

/**
 * Whether the webview's own menu stays: in a text field or over selected text,
 * where it is the platform's native menu with Cut, Copy, Paste and spelling.
 */
export function keepsOwnMenu(target: EventTarget | null, selection: Pick<Selection, "isCollapsed"> | null): boolean {
  return typing(target) || (selection !== null && !selection.isCollapsed);
}

/** Shows `entries` as a native menu at the pointer, unless the webview's own menu stays (`keepsOwnMenu`). */
export function showMenu(e: React.MouseEvent, entries: MenuEntry[]) {
  if (keepsOwnMenu(e.target, window.getSelection())) return;
  e.preventDefault();
  const at = new LogicalPosition(e.clientX, e.clientY);
  void Menu.new({ items: entries }).then(async (menu) => {
    await menu.popup(at);
    await menu.close();
  });
}

/** Removes the webview's menu ("Back", "Reload") wherever the app shows none of its own. */
export function suppressWebviewMenu(): () => void {
  const onMenu = (e: MouseEvent) => {
    if (!e.defaultPrevented && !keepsOwnMenu(e.target, window.getSelection())) e.preventDefault();
  };
  window.addEventListener("contextmenu", onMenu);
  return () => window.removeEventListener("contextmenu", onMenu);
}
