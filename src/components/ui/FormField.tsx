import { useId, type ReactNode } from "react";
import { Icon } from "./icons";
import { cn } from "./cn";

export interface FormFieldRenderProps {
  /** 入力欄に付ける id（label の htmlFor と一致） */
  id: string;
  /** hint / error の id。aria-describedby に渡す */
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FormFieldProps {
  label: ReactNode;
  /** 入力欄の id を自分で決めるとき */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** ラベルを label 要素ではなく見出し（ChipGroup など複数ボタンの場合）にする */
  asGroup?: boolean;
  className?: string;
  children: ReactNode | ((ctx: FormFieldRenderProps) => ReactNode);
}

/** ラベル・補足・エラー（circle-alert ＋ 文言）付きのフォーム項目 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  asGroup = false,
  className,
  children,
}: FormFieldProps) {
  const autoId = useId();
  const id = htmlFor ?? `field-${autoId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error);

  const labelContent = (
    <>
      {label}
      {required ? <span className="ml-1 text-danger">必須</span> : null}
    </>
  );

  const body = typeof children === "function" ? children({ id, describedBy, invalid }) : children;

  const inner = (
    <>
      {asGroup ? (
        <span id={`${id}-label`} className="text-base font-medium text-text">
          {labelContent}
        </span>
      ) : (
        <label htmlFor={id} className="text-base font-medium text-text">
          {labelContent}
        </label>
      )}
      {hint ? (
        <p id={hintId} className="text-base text-text-muted">
          {hint}
        </p>
      ) : null}
      {body}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1 text-base text-danger">
          <Icon name="circle-alert" size={16} className="mt-1" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );

  return asGroup ? (
    <div role="group" aria-labelledby={`${id}-label`} className={cn("flex flex-col gap-1.5", className)}>
      {inner}
    </div>
  ) : (
    <div className={cn("flex flex-col gap-1.5", className)}>{inner}</div>
  );
}
