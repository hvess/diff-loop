import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { api } from "./api";
import { chooseFolder } from "./choose";
import { suppressWebviewMenu } from "./contextMenu";
import { installMenuBar } from "./menuBar";
import { matchBackground, showWhenPainted } from "./nativeWindow";
import { ReviewScreen } from "./components/ReviewScreen";
import { Welcome } from "./components/Welcome";
import { isLineCommand, type WindowCommand } from "./keys";
import { bindingFor, findShown, isMac, onPage, wouldBeep } from "./platform";
import { canSend, useStore, windowTitle } from "./store";

/** How often the checkout is polled while focused, only when it cannot be watched. */
const POLL_MS = 2000;

/** Runs a window command (keys.ts); whether it applied, so the key is taken. */
function run(command: WindowCommand, e: KeyboardEvent): boolean {
  if (command === "openFolder") {
    void chooseFolder();
    return true;
  }
  const s = useStore.getState();
  // The rest act on an open checkout; the welcome screen opens projects, not reviews (ADR 0033 §4).
  if (!s.opening) return false;
  switch (command) {
    case "switcher":
      s.setSwitcher(!s.switcher);
      return true;
    case "find":
      s.openFind();
      return true;
    case "findNext":
    case "findPrevious":
      if (!s.find) return false;
      s.stepFind(command === "findNext" ? 1 : -1);
      return true;
    case "nextFile":
    case "previousFile":
      s.stepFile(command === "nextFile" ? 1 : -1);
      return true;
    case "nextUnviewed":
    case "previousUnviewed":
      s.stepUnviewed(command === "nextUnviewed" ? 1 : -1);
      return true;
    case "toggleViewed":
      s.toggleViewed();
      return true;
    case "viewedAndNext":
      s.viewedAndNext();
      return true;
    case "nextComment":
    case "previousComment":
      s.jumpComment(command === "nextComment" ? 1 : -1);
      return true;
    case "comment":
      if (!s.selection || s.composer) return false;
      // Placing a lost draft, Return puts it on the chosen line wherever focus was left (ADR 0015 §2).
      if (s.replacing !== null) {
        s.placeComment(s.selection.side, s.selection.head);
        return true;
      }
      // Otherwise Return stays a focused button's; C is no button's.
      if (e.key === "Enter" && !onPage(e.target)) return false;
      s.composeOnSelection();
      return true;
    case "editComment":
      if (!s.openComment || s.composer) return false;
      s.editComment(s.openComment);
      return true;
    case "deleteComment":
      if (!s.openComment) return false;
      s.deleteComment(s.openComment);
      return true;
    case "resolveComment": {
      // The open card's comment; with none, the one R just resolved, which R again unresolves (ADR 0015 §4).
      const id = s.openComment ?? s.lastResolved;
      if (!id) return false;
      s.resolveComment(id);
      return true;
    }
    case "undo":
      if (!s.undo) return false;
      s.undoLast();
      return true;
    case "copyReview":
      if (s.comments.length === 0 || !canSend(s)) return false;
      void s.copyReview();
      return true;
    case "preview":
      if (s.comments.length === 0) return false;
      s.setPreview(true);
      return true;
    case "basePicker":
      s.setBasePicker(true);
      return true;
    case "unified":
    case "split":
      s.setMode(command);
      return true;
    case "showAllLines":
      if (s.selected === null) return false;
      void s.showAllLines(s.selected);
      return true;
    case "checkForChanges":
      void s.refresh();
      return true;
    case "closeFolder":
      // A comment being written keeps its draft: the folder closes once it is saved or cancelled.
      if (s.composer) return false;
      s.closeRepository();
      return true;
    case "escape":
      // Placing a draft, then the open card, then a find bar the reader can see (its field closes it itself).
      if (s.replacing !== null) s.cancelReplace();
      else if (s.openComment) s.toggleComment(null);
      else if (s.find && findShown()) s.closeFind();
      else if (s.selection) s.setSelection(null);
      else return false;
      return true;
  }
}

export function App() {
  const hasRepository = useStore((s) => s.opening !== null);
  const title = useStore(windowTitle);
  const [dropping, setDropping] = useState(false);

  // The window list names the review, so another window's notice can say where it is (ADR 0026 §9).
  useEffect(() => {
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [title]);

  useEffect(() => {
    homeDir().then(
      (home) => useStore.getState().setHome(home),
      () => {},
    );
  }, []);

  useEffect(() => {
    showWhenPainted();
    const stopBackground = matchBackground();
    const stopMenu = suppressWebviewMenu();
    // diff-loop-app.md Decision 18: macOS only.
    const menuBar = isMac ? installMenuBar() : null;
    return () => {
      stopBackground();
      stopMenu();
      void menuBar?.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") setDropping(true);
      else setDropping(false);
      if (event.payload.type === "drop" && event.payload.paths[0]) {
        void useStore.getState().open(event.payload.paths[0]);
      }
    });
    return () => void unlisten.then((f) => f());
  }, []);

  useEffect(() => {
    api.launchPath().then((path) => {
      if (path) void useStore.getState().open(path);
    }, () => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A focused control that took the key (the file list's arrows) keeps it.
      if (e.defaultPrevented) return;
      const bound = bindingFor(e);
      // The diff's own keys are `DiffView`'s, which holds its rows.
      if (bound && !isLineCommand(bound.command) && run(bound.command, e)) {
        e.preventDefault();
        return;
      }
      // On macOS a key the webview leaves unhandled sounds the alert beep.
      if (isMac && wouldBeep(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.hasFocus()) void useStore.getState().poll();
    };
    const timer = window.setInterval(() => {
      if (!useStore.getState().watching) tick();
    }, POLL_MS);
    const unlisten = listen("repository-changed", () => void useStore.getState().poll());
    const unlistenReview = listen("review-changed", () => void useStore.getState().takeAgentMarks());
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      void unlisten.then((f) => f());
      void unlistenReview.then((f) => f());
    };
  }, []);

  return (
    <div className="relative h-full">
      {hasRepository ? <ReviewScreen /> : <Welcome />}
      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] shadow-[inset_0_0_0_3px_var(--accent)]" />
      )}
    </div>
  );
}
