// Times and ids as the window shows them.

/** A commit id as shown: its first seven characters. */
export function shortId(commit: string | null): string {
  return commit === null ? "—" : commit.slice(0, 7);
}

const DAY = 24 * 60 * 60 * 1000;

/** "2 min ago", "Yesterday", "Mon", "Oct 9". */
export function when(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at >= today.getTime() - DAY) return "Yesterday";
  if (at >= today.getTime() - 6 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
