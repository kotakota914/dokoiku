"use client";

/**
 * F-1-9：トップ（S-01）の「リスト表示の切替」。ログイン中だけ MapHome が表示する。
 * - ボタン（bookmark）でリスト一覧（GET /lists）を開き、選ぶと GET /lists/{id} でスポットと拠点を取得する
 * - 表示中は地図の上に「〇〇を表示中」と拠点、「表示を解除」を出す
 * 同心円は出さない（v0.3 Q1）。
 */
import { useCallback, useState } from "react";
import { normalizeLists } from "@/components/list/ListPicker";
import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  ErrorMessage,
  Icon,
  IconButton,
  LoadingState,
  Spinner,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import type { Wishlist, WishlistDetail } from "@/lib/domain/types";
import { highlightSummary, toListHighlight, type ListHighlight } from "./listHighlight";

export interface ListHighlightButtonProps {
  active: ListHighlight | null;
  onSelect: (highlight: ListHighlight) => void;
  onClear: () => void;
  className?: string;
}

/** 検索バーの横に置くボタンと、リストを選ぶダイアログ */
export function ListHighlightButton({ active, onSelect, onClear, className }: ListHighlightButtonProps) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<Wishlist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLists(normalizeLists(await api.get<unknown>("/lists")));
    } catch (err) {
      setError(errorMessage(err, "リストを読み込めませんでした"));
    } finally {
      setLoading(false);
    }
  }, []);

  const openDialog = useCallback(() => {
    setOpen(true);
    setSelectError(null);
    void load();
  }, [load]);

  const close = useCallback(() => setOpen(false), []);

  const select = useCallback(
    async (list: Wishlist) => {
      setSelectingId(list.id);
      setSelectError(null);
      try {
        const detail = await api.get<WishlistDetail>(`/lists/${encodeURIComponent(list.id)}`);
        onSelect(toListHighlight(detail));
        setOpen(false);
      } catch (err) {
        setSelectError(errorMessage(err, "リストを読み込めませんでした"));
      } finally {
        setSelectingId(null);
      }
    },
    [onSelect],
  );

  let body: React.ReactNode;
  if (loading && lists === null) {
    body = <LoadingState message="リストを読み込んでいます" />;
  } else if (error) {
    body = <ErrorMessage message={error} onRetry={() => void load()} retrying={loading} />;
  } else if (lists && lists.length === 0) {
    body = (
      <EmptyState
        icon="bookmark"
        title="リストがまだありません"
        description="スポットの「行きたい場所リストに追加」からリストを作れます"
        action={
          <ButtonLink href="/lists" variant="secondary" leftIcon="bookmark">
            リストを見る
          </ButtonLink>
        }
      />
    );
  } else if (lists) {
    body = (
      <ul className="flex flex-col gap-2" aria-label="行きたい場所リスト">
        {lists.map((list) => {
          const isActive = active?.listId === list.id;
          const busy = selectingId === list.id;
          return (
            <li key={list.id}>
              <button
                type="button"
                aria-pressed={isActive}
                disabled={selectingId !== null}
                onClick={() => void select(list)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-card border p-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60",
                  isActive
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-surface hover:bg-surface-muted",
                )}
              >
                <Icon name="bookmark" size={20} className="text-text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold text-text">{list.name}</span>
                  <span className="flex flex-wrap items-center gap-x-3 text-base text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="map-pin" size={16} />
                      {list.itemCount}か所
                    </span>
                    {list.baseLocation ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Icon name="house" size={16} />
                        <span className="truncate">{list.baseLabel || "拠点"}</span>
                      </span>
                    ) : null}
                  </span>
                </span>
                {busy ? (
                  <Spinner size={20} label="読み込み中" />
                ) : isActive ? (
                  <span className="inline-flex items-center gap-1 text-base text-primary-strong">
                    <Icon name="check" size={16} />
                    表示中
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="リストを地図に表示"
        aria-pressed={active !== null}
        aria-haspopup="dialog"
        title="リストを地図に表示"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full border border-border shadow-[var(--shadow-card)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          active ? "bg-primary-soft text-primary-strong" : "bg-surface text-text hover:bg-surface-muted",
          className,
        )}
      >
        <Icon name="bookmark" size={20} />
      </button>
      <Dialog
        open={open}
        onClose={close}
        title="地図に表示するリスト"
        description="選んだリストのスポットを地図で強調し、拠点を表示します"
        footer={
          active ? (
            <Button
              variant="secondary"
              leftIcon="x"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              表示を解除
            </Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              閉じる
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {selectError ? <ErrorMessage message={selectError} /> : null}
          {body}
        </div>
      </Dialog>
    </>
  );
}

export interface ListHighlightStatusProps {
  highlight: ListHighlight;
  onClear: () => void;
  className?: string;
}

/** 表示中のリストの案内（地図の上、カテゴリ絞り込みの下） */
export function ListHighlightStatus({ highlight, onClear, className }: ListHighlightStatusProps) {
  return (
    <div
      role="status"
      aria-label="表示中のリスト"
      className={cn(
        "flex max-w-full items-center gap-2 self-start rounded-card border border-border bg-surface py-1 pl-3 pr-1 text-base text-text shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <Icon name="bookmark" size={16} className="text-primary" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="truncate font-medium">{highlightSummary(highlight)}</span>
        {highlight.base ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-text-muted">
            <Icon name="house" size={16} />
            <span className="truncate">
              {highlight.base.label ? `拠点：${highlight.base.label}` : "拠点"}
            </span>
          </span>
        ) : null}
      </span>
      <IconButton icon="x" aria-label="リストの表示を解除" variant="ghost" onClick={onClear} />
    </div>
  );
}
