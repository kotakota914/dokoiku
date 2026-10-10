"use client";

/**
 * 「リストに追加」の選択シート（F-4-3）。マップのボトムシート・スポット詳細から使う。
 * - open になったら GET /lists。未ログイン（401）ならログイン画面へ
 * - リストをタップで POST /lists/{id}/items。409 のうち「追加済みです」（F-4-2）は info トースト、
 *   30 か所の上限など他の 409 は API の文言をエラートーストでそのまま表示する
 * - 上限（30 か所）に達したリストは選べない（circle-alert ＋「上限」のバッジ）
 * - 追加に成功したらトーストに「リストを見る」の導線（S-07 へ。要件 7 章の遷移図）
 * - 「新しいリストを作る」で POST /lists → そのまま追加
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { Wishlist } from "@/lib/domain/types";
import {
  Badge,
  BottomSheet,
  Button,
  EmptyState,
  ErrorMessage,
  Icon,
  LoadingState,
  cn,
  useToast,
} from "@/components/ui";
import { ListNameForm } from "./ListNameForm";
import { useListApiError } from "./useListApiError";

/** POST /lists/{id}/items が重複追加のときに返す文言（src/lib/services/lists.ts の ALREADY_ADDED_MESSAGE と同じ） */
export const ALREADY_ADDED_MESSAGE = "追加済みです";

/** 409 のうち「重複追加」だけを追加済みとして扱う（上限超過の 409 は別の文言で返る） */
export function isAlreadyAddedError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "CONFLICT" && err.message === ALREADY_ADDED_MESSAGE;
}

export function listDetailHref(listId: string): string {
  return `/lists/${encodeURIComponent(listId)}`;
}

export interface ListPickerProps {
  spotId: string;
  open: boolean;
  onClose: () => void;
  /** 追加に成功したとき（追加済みの 409 では呼ばない） */
  onAdded?: (list: Wishlist) => void;
}

/** GET /lists は配列か { items } のどちらでも受ける */
export function normalizeLists(res: unknown): Wishlist[] {
  if (Array.isArray(res)) return res as Wishlist[];
  if (res && typeof res === "object") {
    const obj = res as { items?: unknown; lists?: unknown };
    if (Array.isArray(obj.items)) return obj.items as Wishlist[];
    if (Array.isArray(obj.lists)) return obj.lists as Wishlist[];
  }
  return [];
}

export function ListPicker({ spotId, open, onClose, onAdded }: ListPickerProps) {
  const toast = useToast();
  const handleError = useListApiError();
  const [lists, setLists] = useState<Wishlist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<unknown>("/lists");
      setLists(normalizeLists(res));
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setError(errorMessage(err, "リストを読み込めませんでした"));
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  // open が true になった時だけ取得する（load の参照が変わっても再取得しない）
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    if (!open) return;
    void loadRef.current();
  }, [open]);

  // 閉じたら作成フォームの状態を戻す
  function close() {
    setCreating(false);
    setCreateError(null);
    onClose();
  }

  async function addTo(list: Wishlist): Promise<boolean> {
    setAddingId(list.id);
    try {
      await api.post(`/lists/${encodeURIComponent(list.id)}/items`, { spotId });
      toast.show({
        type: "success",
        message: `${list.name}に追加しました`,
        action: { label: "リストを見る", href: listDetailHref(list.id) },
      });
      setLists((prev) =>
        prev ? prev.map((l) => (l.id === list.id ? { ...l, itemCount: l.itemCount + 1 } : l)) : prev,
      );
      onAdded?.(list);
      close();
      return true;
    } catch (err) {
      if (isAlreadyAddedError(err)) {
        toast.info(ALREADY_ADDED_MESSAGE);
        close();
        return false;
      }
      handleError(err, "リストに追加できませんでした");
      return false;
    } finally {
      setAddingId(null);
    }
  }

  async function createAndAdd(name: string) {
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await api.post<Wishlist>("/lists", { name });
      setLists((prev) => [created, ...(prev ?? [])]);
      setCreating(false);
      await addTo(created);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setCreateError(errorMessage(err, "リストを作成できませんでした"));
    } finally {
      setSubmitting(false);
    }
  }

  let body: React.ReactNode;
  if (creating) {
    body = (
      <div className="py-2">
        <ListNameForm
          submitLabel="作成して追加"
          submitting={submitting}
          serverError={createError}
          onSubmit={createAndAdd}
          onCancel={() => {
            setCreating(false);
            setCreateError(null);
          }}
        />
      </div>
    );
  } else if (loading && lists === null) {
    body = <LoadingState message="リストを読み込んでいます" />;
  } else if (error) {
    body = <ErrorMessage message={error} onRetry={() => void load()} retrying={loading} className="my-2" />;
  } else if (!lists || lists.length === 0) {
    body = (
      <EmptyState
        icon="bookmark"
        title="まだリストがありません"
        description="リストを作ると、行きたい場所をまとめて経路を作れます。"
        action={
          <Button leftIcon="plus" onClick={() => setCreating(true)}>
            新しいリストを作る
          </Button>
        }
      />
    );
  } else {
    const canCreate = lists.length < LIMITS.listsPerUser;
    body = (
      <div className="flex flex-col gap-3 py-2">
        <ul className="flex flex-col gap-2" aria-label="リスト一覧">
          {lists.map((list) => {
            const full = list.itemCount >= LIMITS.itemsPerList;
            const busy = addingId === list.id;
            return (
              <li key={list.id}>
                <button
                  type="button"
                  onClick={() => void addTo(list)}
                  disabled={addingId !== null || full}
                  aria-busy={busy || undefined}
                  aria-describedby={full ? `${list.id}-full` : undefined}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-card border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-muted",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Icon name={busy ? "loader-circle" : "bookmark"} size={20} className="text-primary" />
                  <span className="min-w-0 flex-1 truncate text-base font-medium text-text">{list.name}</span>
                  {full ? (
                    <Badge icon="circle-alert" tone="warning" className="shrink-0">
                      上限
                    </Badge>
                  ) : null}
                  <span className={cn("shrink-0 text-base", full ? "text-warning" : "text-text-muted")}>
                    {list.itemCount}/{LIMITS.itemsPerList}
                  </span>
                </button>
                {full ? (
                  <p id={`${list.id}-full`} className="px-3 pt-1 text-base text-text-muted">
                    リストは{LIMITS.itemsPerList}
                    か所までです。追加するにはリストからスポットを減らしてください。
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button
          variant="secondary"
          leftIcon="plus"
          onClick={() => setCreating(true)}
          disabled={!canCreate || addingId !== null}
          fullWidth
        >
          新しいリストを作る
        </Button>
        {!canCreate ? (
          <p className="text-base text-text-muted">リストは{LIMITS.listsPerUser}個まで作れます。</p>
        ) : null}
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={close} title="リストに追加" desktop="dialog" initialSnap="full">
      {body}
    </BottomSheet>
  );
}
