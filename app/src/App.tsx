import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { api } from "./api";
import { chooseFolder } from "./choose";
import { ReviewScreen } from "./components/ReviewScreen";
import { Welcome } from "./components/Welcome";
import { hasMod, typing } from "./platform";
import { useStore } from "./store";

/** How often the checkout is polled while focused, only when it cannot be watched. */
const POLL_MS = 2000;

export function App() {
  const hasRepository = useStore((s) => s.opening !== null);
  const [dropping, setDropping] = useState(false);

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
      if (hasMod(e) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void chooseFolder();
        return;
      }
      const s = useStore.getState();
      if (!s.opening || typing(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const key = e.key.toLowerCase();
      if (key === "v") s.toggleViewed();
      else if (key === "n") s.jumpComment(1);
      else if (key === "p") s.jumpComment(-1);
      else if (key === "c" && s.selection) s.composeOnSelection();
      else if (key === "escape") {
        if (s.openComment) s.toggleComment(null);
        else if (s.selection) s.setSelection(null);
        else return;
      } else return;
      e.preventDefault();
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
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="relative h-full">
      {hasRepository ? <ReviewScreen /> : <Welcome />}
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-50 rounded-2xl border-2 border-dashed border-ghost bg-bg/60" />
      )}
    </div>
  );
}
