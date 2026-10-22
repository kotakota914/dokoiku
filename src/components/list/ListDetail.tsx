"use client";

/**
 * S-07 リスト詳細（F-4-4〜F-4-11）。
 * 名前変更・共有・削除（ヘッダー）、拠点（v0.3 F-4-8）、地図で見る、並べ替え（F-4-9）、
 * 合計滞在時間の目安（F-4-11）、比較の選択（F-4-10）、スポット一覧、経路を作成、保存済みプラン。
 * 距離・並べ替え・合計は端末内で計算し、外部 API は呼ばない。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/api/client";
import { distanceFromBase } from "@/lib/domain/distance";
import type { PlanPlace, PlanSummary, Wishlist, WishlistDetail } from "@/lib/domain/types";
import { formatDateJa } from "@/lib/utils/time";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  Select,
  SuspendedNotice,
  formatMinutes,
  useToast,
} from "@/components/ui";
import { BaseDialog } from "./BaseDialog";
import { ListItemRow } from "./ListItemRow";
import { ListNameDialog } from "./ListNameForm";
import { ListSpotMap } from "./ListSpotMap";
import { ShareDialog } from "./ShareDialog";
import { ListIcon } from "./listIcons";
import {
  BASE_REQUIRED_MESSAGE,
  LIST_SORTS,
  LIST_SORT_LABELS,
  SELECT_MIN,
  SELECT_RANGE_MESSAGE,
  canCompare,
  compareHref,
  sortListItems,
  totalStayMinutes,
  type ListSort,
} from "./listItems";
import { useListApiError } from "./useListApiError";

export interface ListDetailProps {
  list: WishlistDetail;
  currentUserId: string;
}

export function planHref(planId: string): string {
  return `/plans/${encodeURIComponent(planId)}`;
}

export function planCreateHref(listId: string): string {
  return `/lists/${encodeURIComponent(listId)}/plan`;
}

type DialogState =
  | { kind: "none" }
  | { kind: "rename" }
  | { kind: "delete" }
  | { kind: "share" }
  | { kind: "base" }
  | { kind: "clearBase" }
  | { kind: "deletePlan"; plan: PlanSummary };

/** PATCH /lists/{listId} の拠点の入力 */
function baseInputOf(place: PlanPlace) {
  return { label: place.label.trim() || "拠点", location: { lat: place.lat, lng: place.lng } };
}

export function ListDetail({ list: initialList }: ListDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const handleError = useListApiError();
  const { loading: statusLoading, isSuspended } = useSystemStatus();
  const [list, setList] = useState(initialList);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sort, setSort] = useState<ListSort>("added");
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const routeSuspended = !statusLoading && isSuspended("route_planning");
  const routableCount = list.items.filter((i) => i.spot !== null).length;
  const canPlan = routableCount > 0 && !routeSuspended;

  const base =
    list.baseLabel && list.baseLocation ? { label: list.baseLabel, location: list.baseLocation } : null;
  const effectiveSort: ListSort = sort === "distance" && !base ? "added" : sort;
  const sortedItems = useMemo(
    () => sortListItems(list.items, effectiveSort, base?.location ?? null),
    [list.items, effectiveSort, base?.location],
  );
  const totalStay = useMemo(() => totalStayMinutes(list.items), [list.items]);
  const selectedInOrder = sortedItems.filter((i) => selected.includes(i.spotId)).map((i) => i.spotId);

  const sortOptions = LIST_SORTS.map((value) => ({
    value,
    label:
      value === "distance" && !base
        ? `${LIST_SORT_LABELS.distance}：拠点を設定すると選べます`
        : LIST_SORT_LABELS[value],
    disabled: value === "distance" && !base,
  }));

  function close() {
    if (submitting) return;
    setDialog({ kind: "none" });
    setServerError(null);
  }

  async function rename(name: string) {
    setSubmitting(true);
    setServerError(null);
    try {
      const updated = await api.patch<{ name?: string }>(`/lists/${encodeURIComponent(list.id)}`, { name });
      setList((prev) => ({ ...prev, name: updated?.name ?? name }));
      toast.success("リスト名を変更しました");
      setDialog({ kind: "none" });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setServerError(errorMessage(err, "リスト名を変更できませんでした"));
    } finally {
      setSubmitting(false);
    }
  }

  /** v0.3 F-4-8：拠点を設定・変更する */
  async function saveBase(place: PlanPlace) {
    setSubmitting(true);
    setServerError(null);
    const input = baseInputOf(place);
    try {
      const updated = await api.patch<Wishlist>(`/lists/${encodeURIComponent(list.id)}`, { base: input });
      setList((prev) => ({
        ...prev,
        baseLabel: updated?.baseLabel ?? input.label,
        baseLocation: updated?.baseLocation ?? input.location,
      }));
      toast.success(base ? "拠点を変更しました" : "拠点を設定しました");
      setDialog({ kind: "none" });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setServerError(errorMessage(err, "拠点を設定できませんでした"));
    } finally {
      setSubmitting(false);
    }
  }

  /** v0.3 F-4-8：拠点を解除する（base: null） */
  async function clearBase() {
    setSubmitting(true);
    try {
      await api.patch<Wishlist>(`/lists/${encodeURIComponent(list.id)}`, { base: null });
      setList((prev) => ({ ...prev, baseLabel: null, baseLocation: null }));
      if (sort === "distance") setSort("added");
      toast.success("拠点を解除しました");
      setDialog({ kind: "none" });
    } catch (err) {
      handleError(err, "拠点を解除できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeList() {
    setSubmitting(true);
    try {
      await api.delete(`/lists/${encodeURIComponent(list.id)}`);
      toast.success("リストを削除しました");
      router.replace("/lists");
    } catch (err) {
      handleError(err, "リストを削除できませんでした");
      setSubmitting(false);
    }
  }

  async function removePlan(plan: PlanSummary) {
    setSubmitting(true);
    try {
      await api.delete(`/plans/${encodeURIComponent(plan.id)}`);
      setList((prev) => ({ ...prev, plans: prev.plans.filter((p) => p.id !== plan.id) }));
      toast.success("プランを削除しました");
      setDialog({ kind: "none" });
    } catch (err) {
      handleError(err, "プランを削除できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  function exitCompare() {
    setCompareMode(false);
    setSelected([]);
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={list.name}
        backHref="/lists"
        actions={
          <>
            <IconButton
              icon="pencil"
              aria-label="リスト名を変更"
              onClick={() => setDialog({ kind: "rename" })}
            />
            <IconButton icon="share-2" aria-label="共有" onClick={() => setDialog({ kind: "share" })} />
            <IconButton
              icon="trash-2"
              aria-label="リストを削除"
              variant="danger"
              onClick={() => setDialog({ kind: "delete" })}
            />
          </>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
        {list.shareToken ? (
          <p className="inline-flex items-center gap-1 text-base text-text-muted">
            <Icon name="share-2" size={16} />
            共有中
          </p>
        ) : null}

        <Card as="section" aria-labelledby="list-base-heading" className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <ListIcon name="house" size={20} className="text-primary-strong" />
            <h2 id="list-base-heading" className="text-base font-semibold text-text">
              拠点
            </h2>
          </div>
          {base ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-base text-text" data-testid="list-base-label">
                {base.label}
              </span>
              <Button variant="secondary" leftIcon="pencil" onClick={() => setDialog({ kind: "base" })}>
                変更
              </Button>
              <Button variant="ghost" leftIcon="x" onClick={() => setDialog({ kind: "clearBase" })}>
                解除
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-base text-text-muted">{BASE_REQUIRED_MESSAGE}</p>
              <Button variant="secondary" onClick={() => setDialog({ kind: "base" })}>
                <ListIcon name="house" size={20} />
                拠点を設定
              </Button>
            </div>
          )}
        </Card>

        <ListSpotMap items={list.items} />

        <section aria-labelledby="list-items-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="list-items-heading" className="text-lg font-semibold text-text">
              スポット
            </h2>
            <span className="text-base text-text-muted">{list.items.length}件</span>
          </div>
          {routableCount > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 text-base text-text-muted">
              <span className="inline-flex items-center gap-1 text-text" data-testid="list-total-stay">
                <Icon name="clock" size={16} />
                合計 {formatMinutes(totalStay)}＋移動
              </span>
              <span>（滞在時間の目安。1日で回れそうかの参考に）</span>
            </p>
          ) : null}
          {list.items.length === 0 ? (
            <EmptyState
              icon="map-pin"
              title="まだスポットがありません"
              description="スポット詳細の「行きたい場所リストに追加」からこのリストに追加できます。"
              action={
                <ButtonLink href="/" leftIcon="map" variant="secondary">
                  マップで探す
                </ButtonLink>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <ListIcon name="arrow-up-down" size={16} className="text-text-muted" />
                  <span className="sr-only">並べ替え</span>
                  <Select
                    aria-label="並べ替え"
                    value={effectiveSort}
                    options={sortOptions}
                    onChange={(e) => setSort(e.target.value as ListSort)}
                    className="min-w-0"
                  />
                </label>
                {!compareMode ? (
                  <Button
                    variant="secondary"
                    onClick={() => setCompareMode(true)}
                    disabled={routableCount < SELECT_MIN}
                    title={
                      routableCount < SELECT_MIN
                        ? `比較には${SELECT_MIN}件以上のスポットが必要です`
                        : undefined
                    }
                  >
                    <ListIcon name="columns-3" size={20} />
                    比較する
                  </Button>
                ) : null}
              </div>
              {compareMode ? (
                <Card
                  tone="primary"
                  role="region"
                  aria-label="比較の選択"
                  className="flex flex-wrap items-center gap-2 p-3"
                >
                  <span className="text-base font-semibold text-text" aria-live="polite">
                    {selected.length}件選択中
                  </span>
                  <span className="min-w-0 flex-1 text-base text-text-muted">{SELECT_RANGE_MESSAGE}</span>
                  {canCompare(selected.length) ? (
                    <ButtonLink href={compareHref(list.id, selectedInOrder)}>
                      <ListIcon name="columns-3" size={20} />
                      比較
                    </ButtonLink>
                  ) : (
                    <Button disabled>
                      <ListIcon name="columns-3" size={20} />
                      比較
                    </Button>
                  )}
                  <Button variant="ghost" leftIcon="x" onClick={exitCompare}>
                    やめる
                  </Button>
                </Card>
              ) : null}
              <ul className="flex flex-col gap-2" aria-label="リスト内のスポット">
                {sortedItems.map((item) => (
                  <ListItemRow
                    key={item.spotId}
                    listId={list.id}
                    item={item}
                    baseLabel={base?.label ?? null}
                    distanceM={distanceFromBase(base?.location, item.spot)}
                    selectable={compareMode}
                    selected={selected.includes(item.spotId)}
                    onSelectedChange={(spotId, on) =>
                      setSelected((prev) =>
                        on
                          ? prev.includes(spotId)
                            ? prev
                            : [...prev, spotId]
                          : prev.filter((id) => id !== spotId),
                      )
                    }
                    onMustVisitChange={(spotId, mustVisit) =>
                      setList((prev) => ({
                        ...prev,
                        items: prev.items.map((i) => (i.spotId === spotId ? { ...i, mustVisit } : i)),
                      }))
                    }
                    onRemoved={(spotId) => {
                      setSelected((prev) => prev.filter((id) => id !== spotId));
                      setList((prev) => ({
                        ...prev,
                        items: prev.items.filter((i) => i.spotId !== spotId),
                        itemCount: Math.max(0, prev.itemCount - 1),
                      }));
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        <section aria-label="経路作成" className="flex flex-col gap-3">
          {routeSuspended ? (
            <SuspendedNotice feature="route_planning" detail="リストの閲覧と編集は引き続き使えます。" />
          ) : null}
          {canPlan ? (
            <ButtonLink href={planCreateHref(list.id)} leftIcon="route" size="lg" fullWidth>
              経路を作成
            </ButtonLink>
          ) : (
            <Button leftIcon="route" size="lg" fullWidth disabled>
              経路を作成
            </Button>
          )}
          {!routeSuspended && routableCount === 0 ? (
            <p className="text-base text-text-muted">スポットを1か所以上追加すると経路を作成できます。</p>
          ) : null}
        </section>

        <section aria-labelledby="list-plans-heading" className="flex flex-col gap-3">
          <h2 id="list-plans-heading" className="text-lg font-semibold text-text">
            保存済みプラン
          </h2>
          {list.plans.length === 0 ? (
            <p className="text-base text-text-muted">保存したプランはまだありません。</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="保存済みプラン">
              {list.plans.map((plan) => (
                <Card as="li" key={plan.id} className="flex items-center gap-3 p-3">
                  <Link
                    href={planHref(plan.id)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Icon name="route" size={20} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-base font-semibold text-text">
                        {formatDateJa(plan.date)}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 text-base text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="map-pin" size={16} />
                          {plan.spotCount}か所
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Icon name="clock" size={16} />
                          移動 {formatMinutes(plan.totalTravelMin)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Icon name="calendar" size={16} />
                          作成 {formatDateJa(plan.createdAt)}
                        </span>
                      </span>
                    </span>
                    <Icon name="chevron-right" size={20} className="text-text-muted" />
                  </Link>
                  <IconButton
                    icon="trash-2"
                    aria-label={`${formatDateJa(plan.date)}のプランを削除`}
                    variant="danger"
                    onClick={() => setDialog({ kind: "deletePlan", plan })}
                  />
                </Card>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ListNameDialog
        open={dialog.kind === "rename"}
        title="リスト名を変更"
        initialName={list.name}
        submitLabel="変更"
        submitting={submitting}
        serverError={serverError}
        onSubmit={rename}
        onClose={close}
      />
      <BaseDialog
        open={dialog.kind === "base"}
        initial={base ? { ...base.location, label: base.label } : null}
        submitting={submitting}
        serverError={serverError}
        onSubmit={(place) => void saveBase(place)}
        onClose={close}
        onUnauthorized={() => handleError(new ApiClientError(401, { code: "UNAUTHORIZED", message: "" }))}
      />
      <ConfirmDialog
        open={dialog.kind === "clearBase"}
        title="拠点を解除しますか"
        description={
          base
            ? `「${base.label}」を拠点から外します。距離の表示と距離順の並べ替えは使えなくなります。`
            : undefined
        }
        confirmLabel="解除"
        loading={submitting}
        onConfirm={() => void clearBase()}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        title="リストを削除しますか"
        description={`「${list.name}」とリスト内のスポット、保存済みプランを削除します。この操作は取り消せません。`}
        confirmLabel="削除"
        danger
        loading={submitting}
        onConfirm={() => void removeList()}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog.kind === "deletePlan"}
        title="プランを削除しますか"
        description={
          dialog.kind === "deletePlan"
            ? `${formatDateJa(dialog.plan.date)}のプランを削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除"
        danger
        loading={submitting}
        onConfirm={() => {
          if (dialog.kind === "deletePlan") void removePlan(dialog.plan);
        }}
        onCancel={close}
      />
      <ShareDialog
        open={dialog.kind === "share"}
        listId={list.id}
        shareToken={list.shareToken}
        listName={list.name}
        itemCount={list.items.length}
        onClose={close}
        onChange={(shareToken) => setList((prev) => ({ ...prev, shareToken }))}
      />
    </div>
  );
}
