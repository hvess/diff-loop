import { useState } from "react";
import { chooseFolder } from "../choose";
import { modKey } from "../platform";
import { loadRecent, when } from "../recent";
import { useStore } from "../store";
import { TitleBar } from "./TitleBar";

export function Welcome() {
  const problem = useStore((s) => s.openProblem);
  const busy = useStore((s) => s.busy);
  const open = useStore((s) => s.open);
  const [recent] = useState(loadRecent);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 justify-center overflow-auto pt-[120px]">
        <div className="flex w-[560px] flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-[28px] font-semibold tracking-[-0.025em]">Open a repository</h1>
            <p className="m-0 text-[15px] leading-[1.55] text-muted3">
              Choose a git folder or worktree. The app shows whatever branch is checked out there and follows it as
              it changes.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseFolder()}
              title={`${modKey}O`}
              className="rounded-full bg-btn px-5 py-2.5 font-medium text-btn-fg disabled:opacity-60"
            >
              {busy ? "Opening…" : "Open folder…"}
            </button>
            <span className="ml-2 text-[13px] text-muted">or drop a folder onto this window</span>
          </div>
          {problem && (
            <div role="alert" className="flex flex-col gap-1 rounded-[14px] bg-del-bg px-4 py-3.5 text-[13.5px] leading-[1.5]">
              <span className="font-semibold text-del">{problem.title}</span>
              <span>{problem.detail}</span>
            </div>
          )}
          {recent.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="px-3.5 text-xs font-medium text-muted">Recent</span>
              {recent.map((r) => (
                <button
                  type="button"
                  key={r.path}
                  disabled={busy}
                  onClick={() => void open(r.path)}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 rounded-xl px-3.5 py-3 text-left hover:bg-chip focus-visible:bg-chip"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="truncate font-mono text-xs text-muted2">{r.branch}</span>
                  </span>
                  <span className="text-[12.5px] text-muted">{when(r.openedAt)}</span>
                  <span className="truncate font-mono text-[11.5px] text-faint">{r.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
