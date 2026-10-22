"use client";

/**
 * S-09 経路作成（条件入力）。F-5-1 / F-5-2 / F-5-B。
 * - 対象スポット：最大 8 か所。8 か所選んだら他は選べない
 * - 共通の条件：出発地（初期値は拠点）・到着地・日付・時刻・移動手段（初期値 公共交通＋徒歩）・昼食休憩
 * - 作り方：おまかせ / 重視するものを選ぶ / AIと相談
 * 「経路案を作成」で POST /plans/compute → sessionStorage → S-11。「AIと相談する」は下書きを残して S-10 へ。
 * 停止中（F-8）の移動手段・作り方は無効にして理由を出す。
 */
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
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
  LoadingState,
  PageHeader,
  cn,
  type ChipOption,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  FEATURES,
  FEATURE_LABELS,
  INTERESTS,
  LIMITS,
  PACES,
  PACE_LABELS,
  PLAN_DEFAULTS,
  PLAN_METHODS,
  PLAN_METHOD_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type Feature,
  type Interest,
  type Pace,
  type PlanMethod,
  type Priority,
  type TravelMode,
} from "@/lib/domain/constants";
import type { PlanComputeResponse, PlanParams, PlanPlace, WishlistDetail } from "@/lib/domain/types";
import { periodKey } from "@/lib/utils/time";
import { planComputeSchema } from "@/lib/validation/schemas";
import { PlacePicker } from "./PlacePicker";
import { PlanIcon, type PlanIconName } from "./PlanIcon";
import {
  buildPreferences,
  effectiveMode,
  isTransitEstimated,
  methodAvailability,
  modeAvailability,
  restoreSpotSelection,
  selectableItems,
} from "./planFormLogic";
import {
  DEFAULT_PREFERENCES,
  getServerSnapshot,
  parsePlanDraft,
  readPlanDraftRaw,
  savePlanDraft,
  savePlanSession,
  subscribeStorage,
  type PlanDraft,
} from "./planSession";
import { TRAVEL_MODE_ICONS } from "./types";

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

type DestinationMode = "none" | "specify";
const DESTINATION_OPTIONS: ReadonlyArray<ChipOption<DestinationMode>> = [
  { value: "none", label: "指定しない" },
  { value: "specify", label: "指定する" },
];

const METHOD_META: Record<PlanMethod, { icon: PlanIconName; description: string }> = {
  auto: { icon: "wand-sparkles", description: "入力なしで、移動が少なく無理なく回れる案を作ります" },
  preferences: { icon: "list-checks", description: "ペース・重視するもの・優先することを選んで作ります" },
  chat: { icon: "message-circle", description: "希望を文章で伝えると、AIが条件に変えます" },
};

type FieldErrors = Partial<Record<string, string>>;

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

function suspendedFeatureOf(err: ApiClientError): Feature | null {
  const f = (err.details as { feature?: unknown } | undefined)?.feature;
  return typeof f === "string" && (FEATURES as readonly string[]).includes(f) ? (f as Feature) : null;
}

export function listBasePlace(list: Pick<WishlistDetail, "baseLabel" | "baseLocation">): PlanPlace | null {
  if (!list.baseLocation) return null;
  return { lat: list.baseLocation.lat, lng: list.baseLocation.lng, label: list.baseLabel ?? "拠点" };
}

export interface PlanFormPageProps {
  list: WishlistDetail;
}

/** sessionStorage の下書き（「条件を変える」「選択式で作る」）を読んでからフォームを出す */
export function PlanFormPage({ list }: PlanFormPageProps) {
  const raw = useSyncExternalStore(subscribeStorage, () => readPlanDraftRaw(list.id), getServerSnapshot);
  if (raw === undefined) return <LoadingState className="flex-1" message="読み込んでいます" />;
  return <PlanForm list={list} initialDraft={parsePlanDraft(raw)} />;
}

export interface PlanFormProps {
  list: WishlistDetail;
  /** 前回の入力（S-10・S-11 から戻ったとき） */
  initialDraft?: PlanDraft | null;
}

export function PlanForm({ list, initialDraft = null }: PlanFormProps) {
  const router = useRouter();
  const statusView = useSystemStatus();
  const { refresh } = statusView;
  const modes = modeAvailability(statusView);
  const methods = methodAvailability(statusView);
  const transitEstimated = isTransitEstimated(statusView);
  const roadEstimated = !statusView.loading && !statusView.status.capabilities.routing;
  const allModesDisabled = TRAVEL_MODES.every((m) => modes[m].disabled);

  const base = useMemo(() => listBasePlace(list), [list]);
  const candidates = useMemo(() => selectableItems(list.items), [list.items]);
  const deletedCount = list.items.length - candidates.length;

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    restoreSpotSelection(list.items, initialDraft?.spotIds),
  );
  const [origin, setOrigin] = useState<PlanPlace | null>(() => initialDraft?.origin ?? base);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>(
    initialDraft?.destination ? "specify" : "none",
  );
  const [destination, setDestination] = useState<PlanPlace | null>(initialDraft?.destination ?? null);
  const [date, setDate] = useState(() => initialDraft?.date ?? periodKey("day"));
  const [startTime, setStartTime] = useState<string>(initialDraft?.startTime ?? PLAN_DEFAULTS.startTime);
  const [endTime, setEndTime] = useState<string>(initialDraft?.endTime ?? PLAN_DEFAULTS.endTime);
  const [selectedMode, setSelectedMode] = useState<TravelMode>(initialDraft?.mode ?? "transit");
  const [lunchBreak, setLunchBreak] = useState(initialDraft?.lunchBreak ?? true);
  const [selectedMethod, setSelectedMethod] = useState<PlanMethod>(initialDraft?.method ?? "auto");
  const initialPrefs = initialDraft?.preferences ?? DEFAULT_PREFERENCES;
  const [pace, setPace] = useState<Pace>(initialPrefs.pace);
  const [interests, setInterests] = useState<Interest[]>(initialPrefs.interests);
  const [priority, setPriority] = useState<Priority>(initialPrefs.priority);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const spotsHeadingId = useId();
  const methodHeadingId = useId();

  const mode = effectiveMode(selectedMode, modes);
  const method: PlanMethod = methods[selectedMethod].disabled ? "auto" : selectedMethod;
  const selectedSet = new Set(selectedIds);
  const selectedCount = selectedIds.length;
  const atLimit = selectedCount >= LIMITS.planSpotsMax;
  const canSubmit =
    !submitting &&
    selectedCount > 0 &&
    selectedCount <= LIMITS.planSpotsMax &&
    !modes[mode].disabled &&
    !methods[method].disabled;

  const modeOptions: ReadonlyArray<ChipOption<TravelMode>> = TRAVEL_MODES.map((m) => ({
    value: m,
    label: TRAVEL_MODE_LABELS[m],
    icon: TRAVEL_MODE_ICONS[m],
    disabled: modes[m].disabled,
  }));
  const modeReasons = Array.from(
    new Set(TRAVEL_MODES.map((m) => modes[m].reason).filter((r): r is string => !!r)),
  );

  function toggleSpot(spotId: string, checked: boolean) {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(spotId) || prev.length >= LIMITS.planSpotsMax) return prev;
        const next = new Set([...prev, spotId]);
        return candidates.filter((i) => next.has(i.spotId)).map((i) => i.spotId);
      }
      return prev.filter((id) => id !== spotId);
    });
  }

  function goLogin() {
    router.push(loginUrl(currentPath()));
  }

  function currentDraft(): PlanDraft {
    return {
      spotIds: selectedIds,
      origin,
      destination: destinationMode === "specify" ? destination : null,
      date,
      startTime,
      endTime,
      mode,
      lunchBreak,
      method,
      preferences:
        method === "chat" && initialDraft?.method === "chat"
          ? initialDraft.preferences
          : buildPreferences(method, { pace, interests, priority }),
    };
  }

  async function submit() {
    if (!canSubmit) return;
    setApiError(null);
    const draft = currentDraft();
    const fieldErrors: FieldErrors = {};
    if (!draft.origin) fieldErrors.origin = "出発地を選んでください";
    if (destinationMode === "specify" && !draft.destination)
      fieldErrors.destination = "到着地を選んでください";

    const parsed = planComputeSchema.safeParse({
      listId: list.id,
      spotIds: draft.spotIds,
      origin: draft.origin ?? undefined,
      destination: draft.destination,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      mode: draft.mode,
      lunchBreak: draft.lunchBreak,
      method: draft.method,
      preferences: draft.preferences,
    });
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
    savePlanDraft(list.id, draft);

    const listPath = `/lists/${encodeURIComponent(list.id)}/plan`;
    if (method === "chat") {
      router.push(`${listPath}/chat`);
      return;
    }

    const params: PlanParams = parsed.data;
    setSubmitting(true);
    try {
      const response = await api.post<PlanComputeResponse>("/plans/compute", params);
      const spots = candidates.filter((i) => selectedSet.has(i.spotId)).map((i) => i.spot);
      const saved = savePlanSession(list.id, {
        params,
        response,
        spots,
        selectedId: response.candidates[0]?.id ?? null,
      });
      if (!saved) {
        setApiError("この端末では結果を表示できません。ブラウザの設定を確認してください");
        return;
      }
      router.push(`${listPath}/result`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        goLogin();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        const feature = suspendedFeatureOf(err);
        setApiError(
          feature
            ? `現在、${FEATURE_LABELS[feature]}は利用できません。ほかの移動手段をお試しください`
            : "現在、経路作成を利用できません",
        );
        void refresh();
        return;
      }
      setApiError(errorMessage(err, "経路案の作成に失敗しました"));
    } finally {
      setSubmitting(false);
    }
  }

  const listHref = `/lists/${encodeURIComponent(list.id)}`;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="経路作成" backHref={listHref} />
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {allModesDisabled ? (
          <Card tone="warning" role="status" className="flex items-start gap-2">
            <Icon name="circle-pause" size={20} className="mt-0.5 text-warning" />
            <p className="text-base text-text">
              現在、経路作成は利用できません。しばらく時間をおいてからお試しください。
            </p>
          </Card>
        ) : null}

        {/* 対象スポット（F-5-1） */}
        <section aria-labelledby={spotsHeadingId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={spotsHeadingId} className="text-base font-medium text-text">
              対象スポット
            </h2>
            <span className="text-base text-text-muted" aria-live="polite">
              {selectedCount} / {LIMITS.planSpotsMax}か所
            </span>
          </div>
          {candidates.length === 0 ? (
            <Card tone="muted">
              <p className="text-base text-text-muted">
                リストにスポットがありません。スポットを追加してから経路を作成してください。
              </p>
            </Card>
          ) : (
            <Card flush className="px-4">
              <ul className="divide-y divide-border">
                {candidates.map((item) => {
                  const checked = selectedSet.has(item.spotId);
                  return (
                    <li key={item.spotId}>
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atLimit}
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
                  );
                })}
              </ul>
            </Card>
          )}
          {atLimit ? (
            <p role="status" className="flex items-start gap-1 text-base text-text-muted">
              <Icon name="info" size={16} className="mt-1" />
              <span>経路を作れるのは{LIMITS.planSpotsMax}か所までです</span>
            </p>
          ) : null}
          {deletedCount > 0 ? (
            <p className="text-base text-text-muted">削除されたスポット（{deletedCount}件）は選べません。</p>
          ) : null}
          {errors.spotIds ? (
            <p role="alert" className="flex items-start gap-1 text-base text-danger">
              <Icon name="circle-alert" size={16} className="mt-1" />
              <span>{errors.spotIds}</span>
            </p>
          ) : null}
        </section>

        {/* 共通の条件（F-5-2） */}
        <PlacePicker
          label="出発地"
          value={origin}
          onChange={setOrigin}
          error={errors.origin}
          onUnauthorized={goLogin}
          base={base}
        />

        <FormField
          label="到着地"
          asGroup
          hint="指定しなければ最後のスポットで終わります"
          error={errors.destination}
        >
          {({ id }) => (
            <div className="flex flex-col gap-3">
              <ChipGroup
                aria-labelledby={`${id}-label`}
                options={DESTINATION_OPTIONS}
                value={destinationMode}
                onChange={(v) => {
                  if (v) setDestinationMode(v);
                }}
              />
              {destinationMode === "specify" ? (
                <PlacePicker
                  label="到着地を選ぶ"
                  value={destination}
                  onChange={setDestination}
                  onUnauthorized={goLogin}
                  base={base}
                />
              ) : null}
            </div>
          )}
        </FormField>

        <FormField label="日付" error={errors.date}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={date}
              aria-describedby={describedBy}
              invalid={invalid}
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
                onChange={(e) => setEndTime(e.target.value)}
              />
            )}
          </FormField>
        </div>

        <FormField label="移動手段" asGroup error={errors.mode}>
          {({ id }) => (
            <div className="flex flex-col gap-2">
              <ChipGroup
                aria-labelledby={`${id}-label`}
                options={modeOptions}
                value={mode}
                onChange={(v) => {
                  if (v) setSelectedMode(v);
                }}
              />
              {modeReasons.map((reason) => (
                <p key={reason} className="flex items-start gap-1 text-base text-text-muted">
                  <Icon name="circle-pause" size={16} className="mt-1" />
                  <span>{reason}</span>
                </p>
              ))}
              {mode === "transit" && transitEstimated ? (
                <p className="flex items-start gap-1 text-base text-text-muted">
                  <Icon name="info" size={16} className="mt-1" />
                  <span>公共交通の移動時間は目安（概算）で計算します</span>
                </p>
              ) : null}
              {mode !== "transit" && roadEstimated ? (
                <p className="flex items-start gap-1 text-base text-text-muted">
                  <Icon name="info" size={16} className="mt-1" />
                  <span>外部の経路サービスが未設定のため、移動時間は直線距離からの概算になります</span>
                </p>
              ) : null}
            </div>
          )}
        </FormField>

        <Checkbox
          checked={lunchBreak}
          onChange={(e) => setLunchBreak(e.target.checked)}
          label={
            <span className="inline-flex items-center gap-2">
              <Icon name="coffee" size={20} />
              昼食休憩を入れる
            </span>
          }
          description={`入れる場合は ${PLAN_DEFAULTS.lunchWindowStart}〜${PLAN_DEFAULTS.lunchWindowEnd} の間に ${PLAN_DEFAULTS.lunchMinutes} 分入れます`}
        />

        {/* 作り方（F-5-B） */}
        <section aria-labelledby={methodHeadingId} className="flex flex-col gap-2">
          <h2 id={methodHeadingId} className="text-base font-medium text-text">
            作り方
          </h2>
          <div role="radiogroup" aria-labelledby={methodHeadingId} className="grid gap-2 sm:grid-cols-3">
            {PLAN_METHODS.map((m) => {
              const on = method === m;
              const disabled = methods[m].disabled;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => setSelectedMethod(m)}
                  className={cn(
                    "flex min-h-11 flex-col items-start gap-1 rounded-card border p-4 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-muted",
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-base font-medium text-text">
                    <PlanIcon name={METHOD_META[m].icon} size={20} />
                    {PLAN_METHOD_LABELS[m]}
                  </span>
                  <span className="text-base text-text-muted">{METHOD_META[m].description}</span>
                </button>
              );
            })}
          </div>
          {PLAN_METHODS.map((m) =>
            methods[m].reason ? (
              <p key={m} className="flex items-start gap-1 text-base text-text-muted">
                <Icon name="circle-pause" size={16} className="mt-1" />
                <span>{methods[m].reason}。ほかの作り方は使えます。</span>
              </p>
            ) : null,
          )}
        </section>

        {method === "preferences" ? (
          <Card className="flex flex-col gap-5">
            <FormField label="旅行のペース" asGroup error={errors.preferences}>
              {({ id }) => (
                <ChipGroup
                  aria-labelledby={`${id}-label`}
                  options={PACE_OPTIONS}
                  value={pace}
                  onChange={(v) => {
                    if (v) setPace(v);
                  }}
                />
              )}
            </FormField>
            <FormField
              label="重視するもの"
              asGroup
              hint="複数選べます。選んだカテゴリの滞在時間を長めにし、外しにくくします"
            >
              {({ id }) => (
                <ChipGroup
                  aria-labelledby={`${id}-label`}
                  multiple
                  options={INTEREST_OPTIONS}
                  value={interests}
                  onChange={setInterests}
                />
              )}
            </FormField>
            <FormField label="優先すること" asGroup>
              {({ id }) => (
                <ChipGroup
                  aria-labelledby={`${id}-label`}
                  options={PRIORITY_OPTIONS}
                  value={priority}
                  onChange={(v) => {
                    if (v) setPriority(v);
                  }}
                />
              )}
            </FormField>
          </Card>
        ) : null}

        {apiError ? (
          <ErrorMessage message={apiError} onRetry={canSubmit ? () => void submit() : undefined} />
        ) : null}

        {method === "chat" ? (
          <Button type="submit" size="lg" fullWidth disabled={!canSubmit}>
            <PlanIcon name="message-circle" size={20} />
            AIと相談する
          </Button>
        ) : (
          <Button
            type="submit"
            size="lg"
            leftIcon="route"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
          >
            経路案を作成
          </Button>
        )}
        {submitting ? (
          <p className="text-center text-base text-text-muted" role="status">
            経路案を計算しています。少しお待ちください
          </p>
        ) : null}
      </form>
    </div>
  );
}
