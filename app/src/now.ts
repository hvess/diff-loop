import { useEffect, useState } from "react";

/** How often "18 min ago" is read again. */
const TICK_MS = 60_000;

/** The time, in milliseconds since the epoch, read again every minute while the component is shown. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
