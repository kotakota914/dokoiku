import type { LucideIcon } from "lucide-react";
import { House, ListChecks, MessageCircle, Navigation, Send, WandSparkles } from "lucide-react";
import { cn, type IconSize } from "@/components/ui";

/**
 * 経路作成画面で使う、共通の Icon 部品（src/components/ui/icons.tsx）にまだ無いアイコン（8.1 の対応表）。
 * 見た目は Icon と同じ（strokeWidth 2、currentColor、aria-hidden）。共通部品に登録されたら置き換えてよい。
 * send は対応表に無い用途（チャットの送信）。
 */
const PLAN_ICONS = {
  "wand-sparkles": WandSparkles,
  "list-checks": ListChecks,
  "message-circle": MessageCircle,
  navigation: Navigation,
  house: House,
  send: Send,
} as const satisfies Record<string, LucideIcon>;

export type PlanIconName = keyof typeof PLAN_ICONS;

export interface PlanIconProps {
  name: PlanIconName;
  size?: IconSize;
  className?: string;
}

export function PlanIcon({ name, size = 16, className }: PlanIconProps) {
  const Component = PLAN_ICONS[name];
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
