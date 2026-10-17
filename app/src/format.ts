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

const MINUTE = 60 * 1000;

/** How long ago `at` was, as the base picker's lists say it: "now", "5m", "2h", "1d", "2w", "3mo", "1y". */
export function age(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / MINUTE);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.min(11, Math.floor(days / 30))}mo`;
  return `${Math.floor(days / 365)}y`;
}
