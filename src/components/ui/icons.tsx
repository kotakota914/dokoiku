import type { LucideIcon } from "lucide-react";
import {
  Aperture,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Calendar,
  Camera,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CirclePause,
  Clock,
  Coffee,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  Flag,
  Flame,
  Footprints,
  GripVertical,
  Heart,
  House,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Landmark,
  List,
  ListChecks,
  LoaderCircle,
  LocateFixed,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Ruler,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  TrainFront,
  Trees,
  TrendingUp,
  TriangleAlert,
  User,
  Utensils,
  WandSparkles,
  X,
} from "lucide-react";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  POPULARITY_LABELS,
  STAY_DURATION_LABELS,
  type Category,
  type Popularity,
  type StayDuration,
} from "@/lib/domain/constants";
import { cn } from "./cn";

/**
 * 8.1 の対応表。アイコン名（kebab-case）→ lucide-react の実体。
 * 対応表に無い用途（レビュー後に追加。docs/decisions.md）：人気 → trending-up、プラン保存 → save、
 * 非表示 → eye-off、次へ・進む → chevron-right、リンクをコピー → copy、画像を保存 → download
 * v0.3 の追加：拠点 → house、距離 → ruler、比較 → columns-3、並べ替え → arrow-up-down、
 * おまかせ / 重視するものを選ぶ / AIと相談 → wand-sparkles / list-checks / message-circle、ナビを開始 → navigation、
 * 公共交通 → train-front（v0.1 から登録済み）
 */
const ICONS = {
  map: MapIcon,
  bookmark: Bookmark,
  "bookmark-plus": BookmarkPlus,
  camera: Camera,
  user: User,
  search: Search,
  "sliders-horizontal": SlidersHorizontal,
  "locate-fixed": LocateFixed,
  "map-pin": MapPin,
  "image-plus": ImagePlus,
  heart: Heart,
  star: Star,
  flame: Flame,
  "trending-up": TrendingUp,
  route: Route,
  footprints: Footprints,
  car: Car,
  "train-front": TrainFront,
  clock: Clock,
  utensils: Utensils,
  coffee: Coffee,
  "share-2": Share2,
  save: Save,
  "eye-off": EyeOff,
  flag: Flag,
  pencil: Pencil,
  "trash-2": Trash2,
  x: X,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "external-link": ExternalLink,
  copy: Copy,
  download: Download,
  "refresh-cw": RefreshCw,
  "loader-circle": LoaderCircle,
  "circle-alert": CircleAlert,
  "triangle-alert": TriangleAlert,
  "circle-pause": CirclePause,
  "log-in": LogIn,
  "log-out": LogOut,
  trees: Trees,
  landmark: Landmark,
  aperture: Aperture,
  check: Check,
  plus: Plus,
  minus: Minus,
  "grip-vertical": GripVertical,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  calendar: Calendar,
  list: List,
  image: ImageIcon,
  info: Info,
  // v0.3 8.1 で追加（拠点・距離・比較・並べ替え・経路の作り方・ナビ）
  house: House,
  ruler: Ruler,
  "columns-3": Columns3,
  "arrow-up-down": ArrowUpDown,
  "wand-sparkles": WandSparkles,
  "list-checks": ListChecks,
  "message-circle": MessageCircle,
  navigation: Navigation,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
/** 8.1：本文横 16 / ボタン 20 / 下部ナビ 24 */
export type IconSize = 16 | 20 | 24;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
}

/** 装飾用アイコン。意味は隣の文字で伝えるため aria-hidden。loader-circle は自動で回転する */
export function Icon({ name, size = 16, className }: IconProps) {
  const Component = ICONS[name];
  return (
    <Component
      size={size}
      strokeWidth={2}
      color="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", name === "loader-circle" && "animate-spin", className)}
    />
  );
}

export interface CategoryIconProps {
  category: Category;
  size?: IconSize;
  className?: string;
}

/** カテゴリのアイコン（CATEGORY_ICONS に従う） */
export function CategoryIcon({ category, size = 16, className }: CategoryIconProps) {
  return <Icon name={CATEGORY_ICONS[category]} size={size} className={className} />;
}

export interface CategoryLabelProps extends CategoryIconProps {
  /** 文字を省略してアイコンだけにしたいときは false（その場合も title で意味を残す） */
  showLabel?: boolean;
}

/** カテゴリをアイコン＋文字で表示する */
export function CategoryLabel({ category, size = 16, className, showLabel = true }: CategoryLabelProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={CATEGORY_LABELS[category]}>
      <CategoryIcon category={category} size={size} />
      {showLabel ? (
        <span>{CATEGORY_LABELS[category]}</span>
      ) : (
        <span className="sr-only">{CATEGORY_LABELS[category]}</span>
      )}
    </span>
  );
}

const POPULARITY_ICON: Record<Popularity, IconName> = {
  normal: "info",
  popular: "trending-up",
  very_popular: "flame",
};

const POPULARITY_CLASS: Record<Popularity, string> = {
  normal: "border-popularity-normal text-text-muted bg-surface",
  popular: "border-popularity-popular text-text bg-surface",
  very_popular: "border-popularity-very text-text bg-warning-soft",
};

export interface PopularityBadgeProps {
  popularity: Popularity;
  /** 「通常」は表示しない（混雑感を出さないため既定で非表示） */
  hideNormal?: boolean;
  className?: string;
}

/** 人気度バッジ（F-1-5）。色だけに頼らず文字ラベルを添える。大人気は flame、人気は trending-up（1 アイコン 1 意味） */
export function PopularityBadge({ popularity, hideNormal = true, className }: PopularityBadgeProps) {
  if (popularity === "normal" && hideNormal) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-base font-medium leading-6",
        POPULARITY_CLASS[popularity],
        className,
      )}
    >
      <Icon name={POPULARITY_ICON[popularity]} size={16} />
      <span>{POPULARITY_LABELS[popularity]}</span>
    </span>
  );
}

export interface StayDurationLabelProps {
  /** 投稿の選択値（任意） */
  duration?: StayDuration | null;
  /** スポットの滞在時間の中央値など、分で表す値（duration より優先） */
  minutes?: number | null;
  /** 両方とも無いときの文言 */
  emptyLabel?: string;
  size?: IconSize;
  className?: string;
}

/** 滞在時間をアイコン（clock）＋文字で表示する */
export function StayDurationLabel({
  duration,
  minutes,
  emptyLabel = "滞在時間 未設定",
  size = 16,
  className,
}: StayDurationLabelProps) {
  const text =
    typeof minutes === "number"
      ? formatMinutes(minutes)
      : duration
        ? STAY_DURATION_LABELS[duration]
        : emptyLabel;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon name="clock" size={size} />
      <span>{text}</span>
    </span>
  );
}

/** 分を「約1時間30分」のような文字にする */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `約${rest}分`;
  if (rest === 0) return `約${h}時間`;
  return `約${h}時間${rest}分`;
}
