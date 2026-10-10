"use client";

import { useState, type ChangeEvent, type ComponentPropsWithRef, type ReactNode } from "react";
import { Icon } from "./icons";
import { cn } from "./cn";

/** 入力欄の共通スタイル。16px 以上（iOS の自動ズーム防止） */
export const FIELD_CLASS =
  "w-full rounded-card border border-border bg-surface px-3 text-base text-text placeholder:text-text-faint " +
  "focus:outline-2 focus:outline-offset-0 focus:outline-primary disabled:cursor-not-allowed disabled:bg-surface-muted " +
  "aria-invalid:border-danger";

export interface InputProps extends ComponentPropsWithRef<"input"> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input aria-invalid={invalid || undefined} className={cn(FIELD_CLASS, "min-h-11", className)} {...rest} />
  );
}

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
  /** maxLength があるとき残り文字数を表示する（F-2-8）。既定 true */
  showCount?: boolean;
}

/** 複数行入力。maxLength を渡すと「残り N 文字」を表示する */
export function Textarea({
  invalid,
  showCount = true,
  maxLength,
  className,
  onChange,
  value,
  defaultValue,
  ...rest
}: TextareaProps) {
  // 非制御でも残り文字数を出せるように内部で長さを持つ
  const [innerLength, setInnerLength] = useState(() => String(defaultValue ?? "").length);
  const length = value !== undefined ? String(value).length : innerLength;
  const remaining = typeof maxLength === "number" ? maxLength - length : null;

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInnerLength(e.target.value.length);
    onChange?.(e);
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        aria-invalid={invalid || undefined}
        maxLength={maxLength}
        className={cn(FIELD_CLASS, "min-h-24 py-2 leading-relaxed", className)}
        onChange={handleChange}
        value={value}
        defaultValue={defaultValue}
        {...rest}
      />
      {showCount && remaining !== null ? (
        <p
          className={cn("self-end text-base", remaining < 0 ? "text-danger" : "text-text-muted")}
          aria-live="polite"
        >
          残り {remaining} 文字
        </p>
      ) : null}
    </div>
  );
}

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> extends Omit<
  ComponentPropsWithRef<"select">,
  "children"
> {
  invalid?: boolean;
  options?: ReadonlyArray<SelectOption<V>>;
  /** 未選択の表示（value="" の無効な option として出す） */
  placeholder?: string;
  children?: ReactNode;
}

export function Select<V extends string = string>({
  invalid,
  options,
  placeholder,
  className,
  children,
  ...rest
}: SelectProps<V>) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(FIELD_CLASS, "min-h-11 appearance-none pr-10", className)}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-text-muted">
        <Icon name="chevron-right" size={16} className="rotate-90" />
      </span>
    </div>
  );
}

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /** ラベル文言（必須。クリック領域に含める） */
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2", className)}>
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        {...rest}
      />
      <span className="flex flex-col">
        <span className="text-base text-text">{label}</span>
        {description ? <span className="text-base text-text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
