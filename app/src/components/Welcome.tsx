import { useEffect } from "react";
import appIcon from "../../src-tauri/icons/128x128@2x.png";
import { chooseFolder } from "../choose";
import { useDelayed } from "../delay";
import { isMac, modKey } from "../platform";
import { tildify } from "../path";
import { useStore } from "../store";
import { Sym } from "./Icon";
import { TitleBar } from "./TitleBar";

/** The window with no project open (ADR 0027, screen 1a): open one on the left, the projects opened last on the right (ADR 0033). */
export function Welcome() {
  const problem = useStore((s) => s.openProblem);
  const busy = useStore((s) => s.busy);
  const slow = useDelayed(busy);
  const recent = useStore((s) => s.recentProjects);
  const home = useStore((s) => s.home);
  const open = useStore((s) => s.open);
  const refreshReviews = useStore((s) => s.refreshReviews);
  // As the app starts, and each time it comes back here: reviews of deleted branches go (ADR 0026 §6).
  useEffect(() => void refreshReviews(), [refreshReviews]);
  const listed = recent.length > 0;
  return (
    <div className="relative flex h-full">
      <TitleBar className={listed ? "w-[380px]" : "w-full"} />
      <section
        aria-label="Open a project"
        className={`box-border flex flex-col items-center overflow-auto px-10 pt-[18px] pb-8 text-center ${listed ? "w-[380px] flex-none" : "flex-1"}`}
      >
        {/* Room for the window's controls, where the canvas draws them (macOS); the same height elsewhere keeps the layout. */}
        <div aria-hidden className="mt-1 h-4 flex-none" />
        <img src={appIcon} alt="" width={128} height={128} draggable={false} className="mt-[42px] flex-none" />
        <h1 className="m-0 mt-[18px] text-[28px] font-bold tracking-[-0.01em]">Diff Loop</h1>
        <p className="m-0 mt-1.5 text-[13px] leading-[1.45] text-[var(--sec)]">Review what your agent wrote, then hand it back.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseFolder()}
          title={`${modKey}O`}
          className="btnp btnl mt-8"
        >
          <Sym name="folderplus" />
          {slow ? "Opening…" : "Open Folder…"}
        </button>
        <p className="m-0 mt-2.5 text-[11px] text-[var(--sec)]">or drop a folder onto this window</p>
        {problem && (
          <div role="alert" className="mt-5 flex flex-col gap-0.5 rounded-[10px] bg-[var(--redbg)] px-3 py-2.5 text-left text-xs leading-[1.45]">
            <span className="font-semibold text-[var(--deltx)]">{problem.title}</span>
            <span>{problem.detail}</span>
          </div>
        )}
        <p className="m-0 mt-auto pt-6 text-[11px] leading-normal text-[var(--sec)]">
          Each branch you comment on becomes its own review, saved as you write.
        </p>
      </section>
      {listed && (
        <section aria-label="Recent Projects" className="side m-2 ml-0 min-w-0 flex-1">
          <div data-tauri-drag-region={isMac ? "deep" : undefined} className="flex items-center px-3 pt-1.5 pb-2.5">
            <span className="text-[13px] font-semibold">Recent Projects</span>
          </div>
          <div className="flex min-h-0 flex-col overflow-auto">
            {recent.map((project) => {
              const folder = tildify(project.folder, home);
              return (
                <button
                  type="button"
                  key={project.project}
                  disabled={busy}
                  onClick={() => void open(project.folder)}
                  // Focus is a highlight with an inset ring, as in a list (HIG `focus-and-selection`).
                  className="rv flex-none px-3 py-[9px] text-left hover:bg-[var(--rowsel)] focus-visible:bg-[var(--rowsel)] focus-visible:-outline-offset-2"
                >
                  <Sym name="folder" className="flex-none text-[var(--sec)]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px]">{project.name}</span>
                    <span className="truncate text-[11px] text-[var(--sec)]" title={folder}>
                      {folder}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
