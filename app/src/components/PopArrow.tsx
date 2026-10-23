import * as Popover from "@radix-ui/react-popover";

/**
 * The canvas's popover arrow (`.arrow.down`, ADR 0027) where Radix places it: a 0 px tall slot on the edge
 * facing the anchor, so Radix adds nothing to `sideOffset`, and turned for a popover below its anchor.
 */
export function PopArrow() {
  return (
    <Popover.Arrow asChild>
      <span className="relative h-0 w-3.5">
        <span className="arrow down" />
      </span>
    </Popover.Arrow>
  );
}
