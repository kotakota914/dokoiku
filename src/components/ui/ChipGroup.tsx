"use client";

import { Icon, type IconName } from "./icons";
import { cn } from "./cn";

export interface ChipOption<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

interface ChipGroupBaseProps<V extends string> {
  options: ReadonlyArray<ChipOption<V>>;
  /** グループの説明（aria-label）。FormField の label と併用するなら aria-labelledby を使う */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  disabled?: boolean;
}

export interface SingleChipGroupProps<V extends string> extends ChipGroupBaseProps<V> {
  multiple?: false;
  value: V | null;
  onChange: (value: V | null) => void;
  /** 選択中のチップをもう一度押して未選択に戻せるか（任意項目で使う） */
  allowDeselect?: boolean;
}

export interface MultipleChipGroupProps<V extends string> extends ChipGroupBaseProps<V> {
  multiple: true;
  value: ReadonlyArray<V>;
  onChange: (value: V[]) => void;
}

export type ChipGroupProps<V extends string> = SingleChipGroupProps<V> | MultipleChipGroupProps<V>;

const CHIP =
  "inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-base font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-50";
const CHIP_ON = "border-primary bg-primary text-on-primary";
const CHIP_OFF = "border-border bg-surface text-text hover:bg-surface-muted";

/** カテゴリや滞在時間などを選ぶチップ。単一選択は radiogroup、複数選択は aria-pressed */
export function ChipGroup<V extends string>(props: SingleChipGroupProps<V>): React.JSX.Element;
export function ChipGroup<V extends string>(props: MultipleChipGroupProps<V>): React.JSX.Element;
export function ChipGroup<V extends string>(props: ChipGroupProps<V>): React.JSX.Element {
  const { options, className, disabled } = props;
  const groupLabel = { "aria-label": props["aria-label"], "aria-labelledby": props["aria-labelledby"] };

  if (props.multiple) {
    const selected = new Set(props.value);
    return (
      <div role="group" {...groupLabel} className={cn("flex flex-wrap gap-2", className)}>
        {options.map((o) => {
          const on = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={disabled || o.disabled}
              className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(o.value);
                else next.add(o.value);
                props.onChange(options.map((x) => x.value).filter((v) => next.has(v)));
              }}
            >
              {o.icon ? <Icon name={o.icon} size={20} /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  const { value, onChange, allowDeselect = false } = props;
  return (
    <div role="radiogroup" {...groupLabel} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || o.disabled}
            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
            onClick={() => {
              if (on) {
                if (allowDeselect) onChange(null);
                return;
              }
              onChange(o.value);
            }}
          >
            {o.icon ? <Icon name={o.icon} size={20} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
