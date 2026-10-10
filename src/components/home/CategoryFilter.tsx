"use client";

/**
 * カテゴリ絞り込み（F-1-7）。横スクロールのチップ列で複数選択する。
 * 何も選ばなければ全カテゴリを表示する。
 */
import { ChipGroup, Icon, cn, type ChipOption } from "@/components/ui";
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, type Category } from "@/lib/domain/constants";

export const CATEGORY_OPTIONS: ReadonlyArray<ChipOption<Category>> = CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
  icon: CATEGORY_ICONS[c],
}));

export interface CategoryFilterProps {
  value: ReadonlyArray<Category>;
  onChange: (next: Category[]) => void;
  disabled?: boolean;
  className?: string;
}

export function CategoryFilter({ value, onChange, disabled, className }: CategoryFilterProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-[var(--shadow-card)]"
        title="絞り込み"
      >
        <Icon name="sliders-horizontal" size={20} />
        <span className="sr-only">絞り込み</span>
      </span>
      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none]">
        <ChipGroup
          multiple
          aria-label="カテゴリで絞り込み"
          options={CATEGORY_OPTIONS}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="w-max pr-3 [&>button]:bg-surface [&>button]:shadow-[var(--shadow-card)] [&>button[aria-pressed=true]]:bg-primary"
        />
      </div>
    </div>
  );
}
