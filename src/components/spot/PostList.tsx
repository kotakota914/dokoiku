"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { Page, PostView } from "@/lib/domain/types";
import { EmptyState, ErrorMessage, Icon } from "@/components/ui";
import { PostCard } from "./PostCard";

export interface PostListProps {
  spotId: string;
  /** サーバーで取得した最初のページ */
  initialPosts: PostView[];
  initialCursor: string | null;
  currentUserId?: string | null;
}

/** F-3-2：新着順、20 件ずつの無限スクロール（IntersectionObserver で次ページを読む） */
export function PostList({ spotId, initialPosts, initialCursor, currentUserId }: PostListProps) {
  const [posts, setPosts] = useState<PostView[]>(initialPosts);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlight.current || cursor === null) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cursor, limit: String(LIMITS.postsPageSize) });
      const page = await api.get<Page<PostView>>(`/spots/${spotId}/posts?${params.toString()}`);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err, "投稿の読み込みに失敗しました"));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor, spotId]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cursor === null || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, error, loadMore]);

  if (posts.length === 0) {
    return (
      <EmptyState icon="camera" title="まだ投稿がありません" description="最初の投稿をしてみましょう。" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} currentUserId={currentUserId} />
          </li>
        ))}
      </ul>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {error ? (
        <ErrorMessage message={error} onRetry={() => void loadMore()} retrying={loading} />
      ) : loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-4 text-base text-text-muted">
          <Icon name="loader-circle" size={20} />
          <span>読み込み中です</span>
        </div>
      ) : cursor === null ? (
        <p className="py-4 text-center text-base text-text-muted">すべて表示しました</p>
      ) : null}
    </div>
  );
}
