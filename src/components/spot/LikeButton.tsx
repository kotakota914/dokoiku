"use client";

import { useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/api/client";
import { Icon, cn, useToast } from "@/components/ui";
import { useRequireLogin } from "./useRequireLogin";

export interface LikeButtonProps {
  postId: string;
  likeCount: number;
  likedByMe: boolean;
  /** null なら未ログイン（押すとログイン画面へ）。undefined なら API の 401 で判断する */
  currentUserId?: string | null;
  className?: string;
}

/** PUT / DELETE /posts/{postId}/like のレスポンス（likeCount が無ければ楽観値を使う） */
interface LikeResponse {
  likeCount?: number;
  likedByMe?: boolean;
}

/** F-3-3：いいね（heart）。1 人 1 回、もう一度押すと取り消す。楽観的更新 */
export function LikeButton({ postId, likeCount, likedByMe, currentUserId, className }: LikeButtonProps) {
  const [liked, setLiked] = useState(likedByMe);
  const [count, setCount] = useState(likeCount);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const requireLogin = useRequireLogin();

  async function toggle() {
    if (busy) return;
    if (currentUserId === null) {
      requireLogin();
      return;
    }
    const nextLiked = !liked;
    const prevLiked = liked;
    const prevCount = count;
    setLiked(nextLiked);
    setCount(Math.max(0, prevCount + (nextLiked ? 1 : -1)));
    setBusy(true);
    try {
      const res = nextLiked
        ? await api.put<LikeResponse | undefined>(`/posts/${postId}/like`)
        : await api.delete<LikeResponse | undefined>(`/posts/${postId}/like`);
      if (res && typeof res.likeCount === "number") setCount(res.likeCount);
      if (res && typeof res.likedByMe === "boolean") setLiked(res.likedByMe);
    } catch (err) {
      setLiked(prevLiked);
      setCount(prevCount);
      if (err instanceof ApiClientError && err.isUnauthorized) {
        requireLogin();
        return;
      }
      toast.error(errorMessage(err, "いいねに失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? `いいねを取り消す（${count}件）` : `いいねする（${count}件）`}
      disabled={busy}
      onClick={toggle}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center gap-1 rounded-full border px-3 text-base font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed",
        liked
          ? "border-border bg-danger-soft text-danger"
          : "border-border bg-surface text-text hover:bg-surface-muted",
        className,
      )}
    >
      <Icon name="heart" size={20} className={cn(liked && "fill-current")} />
      <span>{count}</span>
    </button>
  );
}
