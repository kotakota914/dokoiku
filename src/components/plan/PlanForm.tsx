"use client";

/**
 * S-08 経路作成（条件入力）。F-5-1 / F-5-2。
 * 入力は planComputeSchema で検証し、POST /plans/compute の結果を sessionStorage に置いて結果画面へ進む。
 */
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  ErrorMessage,
  FormField,
  Icon,
  Input,
  PageHeader,
  SuspendedNotice,
  type ChipOption,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  INTERESTS,
  LIMITS,
  PACES,
  PACE_LABELS,
  PLAN_DEFAULTS,
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type Interest,
  type Pace,
  type TravelMode,
} from "@/lib/domain/constants";
import type { PlanParams, PlanPlace, PlanResult, SpotSummary, WishlistDetail } from "@/lib/domain/types";
import { periodKey } from "@/lib/utils/time";
import { planComputeSchema } from "@/lib/validation/schemas";
import { PlacePicker } from "./PlacePicker";
import { savePlanSession } from "./planSession";
import { PLAN_EMPTY_MESSAGE } from "./types";

const MODE_OPTIONS: ReadonlyArray<ChipOption<TravelMode>> = TRAVEL_MODES.map((m) => ({
  value: m,
  label: TRAVEL_MODE_LABELS[m],
  icon: m === "walking" ? "footprints" : "car",
}));

const PACE_OPTIONS: ReadonlyArray<ChipOption<Pace>> = PACES.map((p) => ({ value: p, label: PACE_LABELS[p] }));

const INTEREST_OPTIONS: ReadonlyArray<ChipOption<Interest>> = INTERESTS.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
  icon: CATEGORY_ICONS[c],
}));

type DestinationMode = "none" | "specify";
const DESTINATION_OPTIONS: ReadonlyArray<ChipOption<DestinationMode>> = [
  { value: "none", label: "出発地に戻らない" },
  { value: "specify", label: "指定する" },
];

type FieldErrors = Partial<Record<string, string>>;

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export interface PlanFormProps {
  list: WishlistDetail;
}

export function PlanForm({ list }: PlanFormProps) {
  const router = useRouter();
  const { status, loading: statusLoading, isSuspended } = useSystemStatus();
  const suspended = !statusLoading && isSuspended("route_planning");
  const estimatedOnly = !statusLoading && !status.capabilities.routing;

  // 対象スポット：削除済み（spot が null）は除外（F-4 例外）
  const candidates = useMemo(
    () => list.items.filter((i): i is typeof i & { spot: SpotSummary } => i.spot !== null),
    [list.items],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(candidates.map((i) => i.spotId)));
  const [origin, setOrigin] = useState<PlanPlace | null>(null);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("none");
  const [destination, setDestination] = useState<PlanPlace | null>(null);
  const [date, setDate] = useState(() => periodKey("day"));
  const [startTime, setStartTime] = useState<string>(PLAN_DEFAULTS.startTime);
  const [endTime, setEndTime] = useState<string>(PLAN_DEFAULTS.endTime);
  const [mode, setMode] = useState<TravelMode>("walking");
  const [pace, setPace] = useState<Pace>("normal");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [lunchBreak, setLunchBreak] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const spotsHeadingId = useId();

  const selectedCount = selectedIds.size;
  const tooMany = selectedCount > LIMITS.planSpotsMax;
  const canSubmit = !suspended && !submitting && !tooMany && selectedCount > 0 && candidates.length > 0;

  function toggleSpot(spotId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(spotId);
      else next.delete(spotId);
      return next;
    });
  }

  function goLogin() {
    router.push(loginUrl(currentPath()));
  }

  function buildInput(): Record<string, unknown> {
    return {
      listId: list.id,
      spotIds: candidates.filter((i) => selectedIds.has(i.spotId)).map((i) => i.spotId),
      origin: origin ?? undefined,
      destination: destinationMode === "specify" ? destination : null,
      date,
      startTime,
      endTime,
      mode,
      pace,
      interests,
      lunchBreak,
    };
  }

  async function submit() {
    if (!canSubmit) return;
    setApiError(null);
    const fieldErrors: FieldErrors = {};
    if (!origin) fieldErrors.origin = "出発地を選んでください";
    if (destinationMode === "specify" && !destination) fieldErrors.destination = "到着地を選んでください";

    const parsed = planComputeSchema.safeParse(buildInput());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0 || !parsed.success) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const params: PlanParams = parsed.data;
    setSubmitting(true);
    try {
      const result = await api.post<PlanResult>("/plans/compute", params);
      const noItems = !result.items.some((i) => i.type === "spot");
      if (noItems && result.skipped.some((s) => s.reason === "time_limit")) {
        setApiError(PLAN_EMPTY_MESSAGE);
        return;
      }
      const spots = candidates.filter((i) => selectedIds.has(i.spotId)).map((i) => i.spot);
      if (!savePlanSession(list.id, { params, result, spots })) {
        setApiError("この端末では結果を表示できません。ブラウザの設定を確認してください");
        return;
      }
      router.push(`/lists/${encodeURIComponent(list.id)}/plan/result`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        goLogin();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setApiError("現在、経路作成を利用できません");
        return;
      }
      setApiError(errorMessage(err, "経路の作成に失敗しました"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="経路作成" backHref={`/lists/${encodeURIComponent(list.id)}`} />
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {suspended ? (
          <SuspendedNotice feature="route_planning" detail="しばらく時間をおいてからお試しください。" />
        ) : null}
        {!suspended && estimatedOnly ? (
          <Card tone="warning" role="status" className="flex items-start gap-2">
            <Icon name="triangle-alert" size={20} className="mt-0.5 text-warning" />
            <p className="text-base text-text">
              外部の経路サービスが未設定のため、移動時間は直線距離からの概算になります
            </p>
          </Card>
        ) : null}

        {/* 対象スポット（F-5-2） */}
        <section aria-labelledby={spotsHeadingId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={spotsHeadingId} className="text-base font-medium text-text">
              対象スポット
            </h2>
            <span
              className={tooMany ? "text-base text-danger" : "text-base text-text-muted"}
              aria-live="polite"
            >
              {selectedCount} / {LIMITS.planSpotsMax}か所
            </span>
          </div>
          <p className="text-base text-text-muted">最大{LIMITS.planSpotsMax}か所まで選べます。</p>
          {candidates.length === 0 ? (
            <Card tone="muted">
              <p className="text-base text-text-muted">
                リストにスポットがありません。スポットを追加してから経路を作成してください。
              </p>
            </Card>
          ) : (
            <Card flush className="px-4">
              <ul className="divide-y divide-border">
                {candidates.map((item) => (
                  <li key={item.spotId}>
                    <Checkbox
                      checked={selectedIds.has(item.spotId)}
                      disabled={suspended}
                      onChange={(e) => toggleSpot(item.spotId, e.target.checked)}
                      label={
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span>{item.spot.name}</span>
                          {item.mustVisit ? (
                            <Badge icon="star" tone="warning">
                              必ず行きたい
                            </Badge>
                          ) : null}
                        </span>
                      }
                      description={
                        <span className="inline-flex items-center gap-1">
                          <Icon name={CATEGORY_ICONS[item.spot.category]} size={16} />
                          {CATEGORY_LABELS[item.spot.category]}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {tooMany ? (
            <p role="alert" className="flex items-start gap-1 text-base text-danger">
              <Icon name="circle-alert" size={16} className="mt-1" />
              <span>スポットは{LIMITS.planSpotsMax}か所までです。選択を減らしてください。</span>
            </p>
          ) : errors.spotIds ? (
            <p role="alert" className="flex items-start gap-1 text-base text-danger">
              <Icon name="circle-alert" size={16} className="mt-1" />
              <span>{errors.spotIds}</span>
            </p>
          ) : null}
        </section>

        {/* 出発地・到着地 */}
        <PlacePicker
          label="出発地"
          value={origin}
          onChange={setOrigin}
          error={errors.origin}
          disabled={suspended}
          onUnauthorized={goLogin}
        />

        <FormField label="到着地" asGroup hint="未指定なら出発地に戻りません" error={errors.destination}>
          {({ id }) => (
            <div className="flex flex-col gap-3">
              <ChipGroup
                aria-labelledby={`${id}-label`}
                options={DESTINATION_OPTIONS}
                value={destinationMode}
                disabled={suspended}
                onChange={(v) => {
                  if (v) setDestinationMode(v);
                }}
              />
              {destinationMode === "specify" ? (
                <PlacePicker
                  label="到着地を選ぶ"
                  value={destination}
                  onChange={setDestination}
                  disabled={suspended}
                  onUnauthorized={goLogin}
                />
              ) : null}
            </div>
          )}
        </FormField>

        {/* 日付・時刻 */}
        <FormField label="日付" error={errors.date}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={date}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={suspended}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="開始時刻" error={errors.startTime}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="time"
                step={300}
                value={startTime}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={suspended}
                onChange={(e) => setStartTime(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="終了時刻" error={errors.endTime}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="time"
                step={300}
                value={endTime}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={suspended}
                onChange={(e) => setEndTime(e.target.value)}
              />
            )}
          </FormField>
        </div>

        <FormField label="移動手段" asGroup error={errors.mode}>
          {({ id }) => (
            <ChipGroup
              aria-labelledby={`${id}-label`}
              options={MODE_OPTIONS}
              value={mode}
              disabled={suspended}
              onChange={(v) => {
                if (v) setMode(v);
              }}
            />
          )}
        </FormField>

        <FormField label="旅行のペース" asGroup error={errors.pace}>
          {({ id }) => (
            <ChipGroup
              aria-labelledby={`${id}-label`}
              options={PACE_OPTIONS}
              value={pace}
              disabled={suspended}
              onChange={(v) => {
                if (v) setPace(v);
              }}
            />
          )}
        </FormField>

        <FormField
          label="重視するもの"
          asGroup
          hint="複数選べます。選んだカテゴリの滞在時間を長めにします"
          error={errors.interests}
        >
          {({ id }) => (
            <ChipGroup
              aria-labelledby={`${id}-label`}
              multiple
              options={INTEREST_OPTIONS}
              value={interests}
              disabled={suspended}
              onChange={setInterests}
            />
          )}
        </FormField>

        <Checkbox
          checked={lunchBreak}
          disabled={suspended}
          onChange={(e) => setLunchBreak(e.target.checked)}
          label={
            <span className="inline-flex items-center gap-2">
              <Icon name="coffee" size={20} />
              昼食休憩を入れる
            </span>
          }
          description={`入れる場合は ${PLAN_DEFAULTS.lunchWindowStart}〜${PLAN_DEFAULTS.lunchWindowEnd} の間に ${PLAN_DEFAULTS.lunchMinutes} 分入れます`}
        />

        {apiError ? <ErrorMessage message={apiError} /> : null}

        <Button type="submit" size="lg" leftIcon="route" fullWidth loading={submitting} disabled={!canSubmit}>
          経路を作成
        </Button>
        {submitting ? (
          <p className="text-center text-base text-text-muted">経路を計算しています。少しお待ちください</p>
        ) : null}
      </form>
    </div>
  );
}
