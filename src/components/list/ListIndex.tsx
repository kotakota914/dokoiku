"use client";

/**
 * S-06 リスト一覧（F-4-1）。カード一覧＋新規作成・名前変更・削除。
 */
import Link from "next/link";
import { useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { Wishlist } from "@/lib/domain/types";
import { formatDateJa } from "@/lib/utils/time";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  useToast,
} from "@/components/ui";
import { ListNameDialog } from "./ListNameForm";
import { useListApiError } from "./useListApiError";

export interface ListIndexProps {
  lists: Wishlist[];
}

export function listHref(listId: string): string {
  return `/lists/${encodeURIComponent(listId)}`;
}

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; list: Wishlist }
  | { kind: "delete"; list: Wishlist };

export function ListIndex({ lists: initialLists }: ListIndexProps) {
  const toast = useToast();
  const handleError = useListApiError();
  const [lists, setLists] = useState(initialLists);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const canCreate = lists.length < LIMITS.listsPerUser;

  function close() {
    if (submitting) return;
    setDialog({ kind: "none" });
    setServerError(null);
  }

  async function create(name: string) {
    setSubmitting(true);
    setServerError(null);
    try {
      const created = await api.post<Wishlist>("/lists", { name });
      setLists((prev) => [created, ...prev]);
      toast.success("リストを作成しました");
      setDialog({ kind: "none" });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleError(err);
        return;
      }
      setServerError(errorMessage(err, "リストを作成できませんでした"));
    } finally {
      setSubmitting(false);
    }
  }

  async function rename(list: Wishlist, name: string) {
    setSubmitting(true);
    setServerError(null);
    try {
      const updated = await api.patch<Wishlist>(`/lists/${encodeURIComponent(list.id)}`, { name });
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, ...updated, name: updated?.name ?? name } : l)),
      );
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

  async function remove(list: Wishlist) {
    setSubmitting(true);
    try {
      await api.delete(`/lists/${encodeURIComponent(list.id)}`);
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      toast.success("リストを削除しました");
      setDialog({ kind: "none" });
    } catch (err) {
      handleError(err, "リストを削除できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="行きたい場所リスト"
        hideBack
        actions={
          <Button leftIcon="plus" onClick={() => setDialog({ kind: "create" })} disabled={!canCreate}>
            新規作成
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        {!canCreate ? (
          <p className="text-base text-text-muted">リストは{LIMITS.listsPerUser}個まで作れます。</p>
        ) : null}
        {lists.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title="行きたい場所をリストにまとめましょう"
            description="スポット詳細の「行きたい場所リストに追加」から追加できます。リストから経路も作れます。"
            action={
              <Button leftIcon="plus" onClick={() => setDialog({ kind: "create" })}>
                新規作成
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="リスト一覧">
            {lists.map((list) => (
              <Card as="li" key={list.id} className="flex items-center gap-3 p-3">
                <Link
                  href={listHref(list.id)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <Icon name="bookmark" size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-base font-semibold text-text">{list.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 text-base text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="map-pin" size={16} />
                        {list.itemCount}件
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Icon name="calendar" size={16} />
                        {formatDateJa(list.createdAt)}
                      </span>
                    </span>
                  </span>
                  <Icon name="chevron-right" size={20} className="text-text-muted" />
                </Link>
                <div className="flex shrink-0 items-center">
                  <IconButton
                    icon="pencil"
                    aria-label={`${list.name}の名前を変更`}
                    onClick={() => setDialog({ kind: "rename", list })}
                  />
                  <IconButton
                    icon="trash-2"
                    aria-label={`${list.name}を削除`}
                    variant="danger"
                    onClick={() => setDialog({ kind: "delete", list })}
                  />
                </div>
              </Card>
            ))}
          </ul>
        )}
      </div>

      <ListNameDialog
        open={dialog.kind === "create"}
        title="新しいリスト"
        submitLabel="作成"
        submitting={submitting}
        serverError={serverError}
        onSubmit={create}
        onClose={close}
      />
      <ListNameDialog
        open={dialog.kind === "rename"}
        title="リスト名を変更"
        initialName={dialog.kind === "rename" ? dialog.list.name : ""}
        submitLabel="変更"
        submitting={submitting}
        serverError={serverError}
        onSubmit={(name) => {
          if (dialog.kind === "rename") void rename(dialog.list, name);
        }}
        onClose={close}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        title="リストを削除しますか"
        description={
          dialog.kind === "delete"
            ? `「${dialog.list.name}」とリスト内のスポット、保存済みプランを削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除"
        danger
        loading={submitting}
        onConfirm={() => {
          if (dialog.kind === "delete") void remove(dialog.list);
        }}
        onCancel={close}
      />
    </>
  );
}
