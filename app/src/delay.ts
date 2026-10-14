import { useEffect, useState } from "react";

/** Waits this long before showing that something is running: shorter waits show nothing (ADR 0010 §6). */
const INDICATOR_DELAY_MS = 200;

/** `active`, once it has stayed true for `INDICATOR_DELAY_MS`; false as soon as it is not. */
export function useDelayed(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setShown(true), INDICATOR_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setShown(false);
    };
  }, [active]);
  return active && shown;
}
