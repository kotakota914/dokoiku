"use client";

/**
 * S-11 経路案の比較（F-5-6〜F-5-10）。sessionStorage の POST /plans/compute の結果を読む。
 * - 最大 3 案の比較表 → 選んだ案（既定は先頭）のタイムライン・地図・入らなかった場所
 * - 並び替え・滞在時間の変更 → POST /plans/recompute（外部 API は呼ばない）→ 選んだ案を差し替え
 * - 「この案を保存」→ POST /plans → S-12。保存前の案には「ナビを開始」を置かない（ADR-0016）
 * - 案が 0 件：「終了時刻を延ばすか、スポットを減らしてください」と「条件を変える」
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorMessage,
  LoadingState,
  PageHeader,
  SuspendedNotice,
  useToast,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import type { Plan, PlanResult } from "@/lib/domain/types";
import { PlanCompareTable } from "./PlanCompareTable";
import { PlanDetail, isOverEndTime, useSpotsById } from "./PlanDetail";
import {
  getServerSnapshot,
  parsePlanSession,
  readPlanSessionRaw,
  savePlanSession,
  subscribeStorage,
  type PlanSession,
} from "./planSession";
import { PLAN_EMPTY_MESSAGE, normalizeCandidate, toPlanResult, type PlanCandidateView } from "./types";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export interface PlanResultPageProps {
  listId: string;
}

/** sessionStorage から結果を読み、無ければ S-09 へ戻す案内を出す */
export function PlanResultPage({ listId }: PlanResultPageProps) {
  const raw = useSyncExternalStore(subscribeStorage, () => readPlanSessionRaw(listId), getServerSnapshot);
  const session = useMemo(() => (raw === undefined ? undefined : parsePlanSession(raw)), [raw]);
  const formHref = `/lists/${encodeURIComponent(listId)}/plan`;

  if (session === undefined) return <LoadingState className="flex-1" message="経路案を読み込んでいます" />;
  if (session === null) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="経路案の比較" backHref={formHref} />
        <EmptyState
          icon="route"
          title="表示できる経路案がありません"
          description="経路案はこのタブを閉じると消えます。条件を入力して、もう一度作成してください。"
          action={
            <ButtonLink href={formHref} leftIcon="route">
              経路作成へ
            </ButtonLink>
          }
        />
      </div>
    );
  }
  return (
    <PlanCompareView
      listId={listId}
      session={session}
      onSessionChange={(next) => savePlanSession(listId, next)}
    />
  );
}

export interface PlanCompareViewProps {
  listId: string;
  session: PlanSession;
  /** 案の差し替え・選択の変更を sessionStorage に残す */
  onSessionChange?: (session: PlanSession) => void;
}

export function PlanCompareView({ listId, session, onSessionChange }: PlanCompareViewProps) {
  const router = useRouter();
  const toast = useToast();
  const { params, spots } = session;
  const travelMatrixId = session.response.travelMatrixId;
  const [candidates, setCandidates] = useState<PlanCandidateView[]>(() =>
    session.response.candidates.map((c) => normalizeCandidate(c)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      session.response.candidates.find((c) => c.id === session.selectedId)?.id ??
      session.response.candidates[0]?.id ??
      null,
  );
  const [stayOverrides, setStayOverrides] = useState<Record<string, number>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const spotsById = useSpotsById(spots);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const formHref = `/lists/${encodeURIComponent(listId)}/plan`;

  const handleUnauthorized = useCallback(() => {
    router.push(loginUrl(currentPath()));
  }, [router]);

  function persist(nextCandidates: PlanCandidateView[], nextSelectedId: string | null) {
    onSessionChange?.({
      ...session,
      response: { ...session.response, candidates: nextCandidates },
      selectedId: nextSelectedId,
    });
  }

  function select(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setStayOverrides({});
    setRecomputeError(null);
    persist(candidates, id);
  }

  async function recompute(order: string[], overrides: Record<string, number>) {
    if (!selected) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const res = await api.post<PlanResult>("/plans/recompute", {
        params,
        travelMatrixId,
        order,
        stayOverrides: overrides,
        candidate: { id: selected.id, kind: selected.kind, label: selected.label },
      });
      const updated = normalizeCandidate(res, selected);
      const next = candidates.map((c) => (c.id === selected.id ? updated : c));
      setCandidates(next);
      setStayOverrides(overrides);
      persist(next, selected.id);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleUnauthorized();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setSuspended(true);
        return;
      }
      setRecomputeError(errorMessage(err, "再計算に失敗しました"));
    } finally {
      setRecomputing(false);
    }
  }

  function currentOrder(): string[] {
    if (!selected) return [];
    return selected.items.flatMap((i) => (i.type === "spot" ? [i.spotId] : []));
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const plan = await api.post<Plan>("/plans", {
        params,
        result: toPlanResult(selected, travelMatrixId, params.mode),
      });
      toast.success("プランを保存しました");
      router.push(`/plans/${encodeURIComponent(plan.id)}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleUnauthorized();
        return;
      }
      setSaveError(errorMessage(err, "保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  if (candidates.length === 0 || !selected) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="経路案の比較" backHref={formHref} />
        <EmptyState
          icon="clock"
          title="時間内に回れる経路案がありませんでした"
          description={PLAN_EMPTY_MESSAGE}
          action={
            <ButtonLink href={formHref} leftIcon="pencil">
              条件を変える
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const overEndTime = isOverEndTime(selected.stats.endAt, params.endTime);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="経路案の比較" backHref={formHref} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4 lg:max-w-4xl">
        {suspended ? (
          <SuspendedNotice feature="route_planning" detail="表示中の経路案はそのまま確認・保存できます。" />
        ) : null}

        <PlanCompareTable
          candidates={candidates}
          selectedId={selected.id}
          onSelect={select}
          spotsById={spotsById}
          disabled={recomputing}
        />

        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          <h2 className="text-lg font-semibold text-text">{selected.label}</h2>
          <PlanDetail
            params={params}
            candidate={selected}
            spotsById={spotsById}
            editable={!suspended}
            busy={recomputing}
            onReorder={(order) => void recompute(order, stayOverrides)}
            onStayChange={(spotId, min) =>
              void recompute(currentOrder(), { ...stayOverrides, [spotId]: min })
            }
            timelineNotice={
              recomputeError ? (
                <ErrorMessage
                  message={recomputeError}
                  onRetry={() => void recompute(currentOrder(), stayOverrides)}
                  retrying={recomputing}
                />
              ) : null
            }
          />

          <div className="flex flex-col gap-2">
            {saveError ? (
              <ErrorMessage message={saveError} onRetry={() => void save()} retrying={saving} />
            ) : null}
            <Button
              size="lg"
              leftIcon="save"
              fullWidth
              loading={saving}
              disabled={recomputing || overEndTime}
              onClick={() => void save()}
            >
              この案を保存
            </Button>
            <ButtonLink href={formHref} variant="secondary" leftIcon="pencil" fullWidth>
              条件を変える
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}
