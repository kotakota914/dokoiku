"use client";

/**
 * S-10：AI が読み取った条件（PlanPreferences）の一覧と修正（F-5-5）。
 * ペース・重視するもの・優先すること・時刻の指定（削除可）・順番の希望（削除可）・除外（チェック）。
 */
import { Card, Checkbox, ChipGroup, FormField, IconButton, type ChipOption } from "@/components/ui";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  INTERESTS,
  PACES,
  PACE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Interest,
  type Pace,
  type Priority,
} from "@/lib/domain/constants";
import type { PlanPreferences } from "@/lib/domain/types";

const PACE_OPTIONS: ReadonlyArray<ChipOption<Pace>> = PACES.map((p) => ({ value: p, label: PACE_LABELS[p] }));
const INTEREST_OPTIONS: ReadonlyArray<ChipOption<Interest>> = INTERESTS.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
  icon: CATEGORY_ICONS[c],
}));
const PRIORITY_OPTIONS: ReadonlyArray<ChipOption<Priority>> = PRIORITIES.map((p) => ({
  value: p,
  label: PRIORITY_LABELS[p],
}));

export interface ConditionSpot {
  id: string;
  name: string;
}

type OrderHint = PlanPreferences["orderHints"][number];

/** 順番の希望を文にする（例：「兼六園を最初に」「兼六園を金沢城公園より前に」） */
export function describeOrderHint(hint: OrderHint, nameOf: (id: string) => string): string {
  const name = nameOf(hint.spotId);
  switch (hint.position) {
    case "first":
      return `${name}を最初に`;
    case "last":
      return `${name}を最後に`;
    case "before":
      return hint.relativeTo ? `${name}を${nameOf(hint.relativeTo)}より前に` : `${name}を前のほうに`;
    case "after":
      return hint.relativeTo ? `${name}を${nameOf(hint.relativeTo)}より後に` : `${name}を後のほうに`;
  }
}

export interface ConditionsEditorProps {
  value: PlanPreferences;
  onChange: (next: PlanPreferences) => void;
  spots: readonly ConditionSpot[];
  disabled?: boolean;
}

export function ConditionsEditor({ value, onChange, spots, disabled }: ConditionsEditorProps) {
  const names = new Map(spots.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => names.get(id) ?? "リストに無い場所";
  const excluded = new Set(value.exclude);

  return (
    <Card className="flex flex-col gap-5">
      <FormField label="旅行のペース" asGroup>
        {({ id }) => (
          <ChipGroup
            aria-labelledby={`${id}-label`}
            options={PACE_OPTIONS}
            value={value.pace}
            disabled={disabled}
            onChange={(v) => {
              if (v) onChange({ ...value, pace: v });
            }}
          />
        )}
      </FormField>

      <FormField label="重視するもの" asGroup>
        {({ id }) => (
          <ChipGroup
            aria-labelledby={`${id}-label`}
            multiple
            options={INTEREST_OPTIONS}
            value={value.interests}
            disabled={disabled}
            onChange={(v) => onChange({ ...value, interests: v })}
          />
        )}
      </FormField>

      <FormField label="優先すること" asGroup>
        {({ id }) => (
          <ChipGroup
            aria-labelledby={`${id}-label`}
            options={PRIORITY_OPTIONS}
            value={value.priority}
            disabled={disabled}
            onChange={(v) => {
              if (v) onChange({ ...value, priority: v });
            }}
          />
        )}
      </FormField>

      <FormField label="時刻の指定" asGroup>
        {() =>
          value.timeWindows.length === 0 ? (
            <p className="text-base text-text-muted">なし</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="時刻の指定">
              {value.timeWindows.map((w, i) => (
                <li key={`${w.spotId}-${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-base text-text">
                    {nameOf(w.spotId)} {w.from}〜{w.to}
                  </span>
                  <IconButton
                    icon="trash-2"
                    aria-label={`${nameOf(w.spotId)}の時刻の指定を削除`}
                    disabled={disabled}
                    onClick={() =>
                      onChange({ ...value, timeWindows: value.timeWindows.filter((_, k) => k !== i) })
                    }
                  />
                </li>
              ))}
            </ul>
          )
        }
      </FormField>

      <FormField label="順番の希望" asGroup>
        {() =>
          value.orderHints.length === 0 ? (
            <p className="text-base text-text-muted">なし</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="順番の希望">
              {value.orderHints.map((h, i) => {
                const text = describeOrderHint(h, nameOf);
                return (
                  <li key={`${h.spotId}-${i}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-base text-text">{text}</span>
                    <IconButton
                      icon="trash-2"
                      aria-label={`順番の希望「${text}」を削除`}
                      disabled={disabled}
                      onClick={() =>
                        onChange({ ...value, orderHints: value.orderHints.filter((_, k) => k !== i) })
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )
        }
      </FormField>

      <FormField label="除外する場所" asGroup hint="チェックした場所は経路に入れません">
        {() => (
          <ul className="flex flex-col">
            {spots.map((s) => (
              <li key={s.id}>
                <Checkbox
                  checked={excluded.has(s.id)}
                  disabled={disabled}
                  label={`${s.name}を除外する`}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      exclude: e.target.checked
                        ? [...value.exclude.filter((id) => id !== s.id), s.id]
                        : value.exclude.filter((id) => id !== s.id),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </FormField>
    </Card>
  );
}
