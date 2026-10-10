"use client";

import { z } from "zod";
import { ChipGroup, FormField, Textarea, type ChipOption } from "@/components/ui";
import {
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  LIMITS,
  STAY_DURATIONS,
  STAY_DURATION_LABELS,
  type Category,
  type StayDuration,
} from "@/lib/domain/constants";
import { createPostSchema } from "@/lib/validation/schemas";
import { WizardFooter } from "./WizardFooter";
import type { ContentValue } from "./types";

/** createPostSchema のうち内容入力に関わる部分（クライアント・サーバーで同じルール） */
export const contentSchema = z.object({
  comment: createPostSchema.shape.comment,
  category: createPostSchema.shape.category,
  stayDuration: createPostSchema.shape.stayDuration,
});

export interface ContentErrors {
  comment?: string;
  category?: string;
  stayDuration?: string;
}

export function validateContent(
  value: ContentValue,
): { ok: true; data: z.infer<typeof contentSchema> } | { ok: false; errors: ContentErrors } {
  const parsed = contentSchema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: ContentErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === "comment" && !errors.comment) errors.comment = issue.message;
    if (key === "category" && !errors.category) errors.category = issue.message;
    if (key === "stayDuration" && !errors.stayDuration) errors.stayDuration = issue.message;
  }
  return { ok: false, errors };
}

export const CATEGORY_OPTIONS: ReadonlyArray<ChipOption<Category>> = CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
  icon: CATEGORY_ICONS[c],
}));

export const STAY_OPTIONS: ReadonlyArray<ChipOption<StayDuration>> = STAY_DURATIONS.map((s) => ({
  value: s,
  label: STAY_DURATION_LABELS[s],
  icon: "clock",
}));

export interface ContentFieldsProps {
  value: ContentValue;
  onChange: (next: ContentValue) => void;
  /** 未選択のカテゴリを「必須」エラーとして出すか（送信を試みた後など） */
  showCategoryError?: boolean;
  disabled?: boolean;
}

/** コメント・カテゴリ・滞在時間の入力欄（S-04 ステップ 3 と S-05 で共用） */
export function ContentFields({
  value,
  onChange,
  showCategoryError = false,
  disabled = false,
}: ContentFieldsProps) {
  const validation = validateContent(value);
  const errors = validation.ok ? {} : validation.errors;
  return (
    <div className="flex flex-col gap-5">
      <FormField label="カテゴリ" required asGroup error={showCategoryError ? errors.category : undefined}>
        {({ id }) => (
          <ChipGroup<Category>
            aria-labelledby={`${id}-label`}
            options={CATEGORY_OPTIONS}
            value={value.category}
            disabled={disabled}
            onChange={(category) => onChange({ ...value, category })}
          />
        )}
      </FormField>

      <FormField
        label="コメント"
        hint={`任意。${LIMITS.commentMax}文字まで。おすすめの時間帯や楽しみ方を書くと役に立ちます`}
        error={errors.comment}
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            value={value.comment}
            maxLength={LIMITS.commentMax}
            showCount
            rows={4}
            disabled={disabled}
            aria-describedby={describedBy}
            invalid={invalid}
            placeholder="例：朝7時前なら人が少なくて写真が撮りやすいです"
            onChange={(e) => onChange({ ...value, comment: e.target.value })}
          />
        )}
      </FormField>

      <FormField label="滞在時間" hint="任意。どのくらい過ごしましたか" asGroup error={errors.stayDuration}>
        {({ id }) => (
          <ChipGroup<StayDuration>
            aria-labelledby={`${id}-label`}
            options={STAY_OPTIONS}
            value={value.stayDuration}
            allowDeselect
            disabled={disabled}
            onChange={(stayDuration) => onChange({ ...value, stayDuration })}
          />
        )}
      </FormField>
    </div>
  );
}

export interface StepContentProps {
  value: ContentValue;
  onChange: (next: ContentValue) => void;
  onBack: () => void;
  onNext: () => void;
}

/** ステップ 3：内容入力（F-2-8〜F-2-10）。検証が通るまで次へは無効 */
export function StepContent({ value, onChange, onBack, onNext }: StepContentProps) {
  const valid = validateContent(value).ok;
  return (
    <div className="flex flex-col gap-4">
      <ContentFields value={value} onChange={onChange} />
      <WizardFooter onBack={onBack} onNext={onNext} nextDisabled={!valid} />
    </div>
  );
}
