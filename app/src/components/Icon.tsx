import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  Columns2,
  Copy,
  Diff,
  File,
  Folder,
  FolderPlus,
  GitBranch,
  Image,
  type LucideIcon,
  MessageSquare,
  MessageSquareText,
  RectangleHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * The canvas's symbols by its own names (`i-folder` is "folder"), each drawn by the Lucide icon nearest the
 * SF Symbol it names, at the canvas's size (ADR 0027 §3).
 */
const SYMBOLS = {
  search: [Search, 14],
  folder: [Folder, 16],
  doc: [File, 15],
  right: [ChevronRight, 12],
  down: [ChevronDown, 12],
  up: [ChevronUp, 12],
  branch: [GitBranch, 15],
  updown: [ChevronsUpDown, 12],
  unified: [RectangleHorizontal, 18],
  split: [Columns2, 18],
  comments: [MessageSquareText, 16],
  copy: [Copy, 14],
  chip: [MessageSquare, 11],
  suggest: [Diff, 14],
  check: [Check, 13],
  back: [ChevronLeft, 13],
  trash: [Trash2, 14],
  photo: [Image, 40],
  changed: [RefreshCw, 11],
  warning: [TriangleAlert, 16],
  resolved: [CircleCheck, 12],
  reset: [RotateCcw, 12],
  folderplus: [FolderPlus, 18],
  empty: [CircleCheck, 48],
  sent: [Send, 11],
  xmark: [X, 11],
} satisfies Record<string, [LucideIcon, number]>;

export type Symbol = keyof typeof SYMBOLS;

/** A canvas symbol: decorative, in the text's colour. */
export function Sym({ name, className = "" }: { name: Symbol; className?: string }) {
  const [Of, size] = SYMBOLS[name];
  return <Of aria-hidden size={size} strokeWidth={2} className={`flex-none ${className}`} />;
}
