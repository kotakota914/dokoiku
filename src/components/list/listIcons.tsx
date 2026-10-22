/**
 * 8.1 の対応表にある v0.3 追加アイコン（拠点 house / 距離 ruler / 比較 columns-3 / 並べ替え arrow-up-down）。
 * `src/components/ui/icons.tsx` への追加はアイコン表の担当（map）が行うため、それまでリスト画面だけで使う薄い包み。
 * 見た目の規約は `Icon` と同じ（strokeWidth 2、currentColor、aria-hidden）。icons.tsx に入ったら `Icon` に置き換える。
 */
import { ArrowUpDown, Columns3, House, Ruler, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui";

const LIST_ICONS = {
  house: House,
  ruler: Ruler,
  "columns-3": Columns3,
  "arrow-up-down": ArrowUpDown,
} as const satisfies Record<string, LucideIcon>;

export type ListIconName = keyof typeof LIST_ICONS;

export interface ListIconProps {
  name: ListIconName;
  size?: 16 | 20 | 24;
  className?: string;
}

export function ListIcon({ name, size = 16, className }: ListIconProps) {
  const Component = LIST_ICONS[name];
  return (
    <Component
      size={size}
      strokeWidth={2}
      color="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    />
  );
}
