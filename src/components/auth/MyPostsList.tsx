"use client";

import { useState } from "react";
import { PostCard } from "@/components/spot/PostCard";
import { Button, ButtonLink, EmptyState, ErrorMessage } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import type { Page, PostView } from "@/lib/domain/types";

export interface MyPostsListProps {
  currentUserId: string;
  /** サーバーで取得した最初のページ */
  initialPage: Page<PostView>;
}

/** S-13：自分の投稿一覧。続きは GET /api/v1/me/posts?cursor= で読み込む */
export function MyPostsList({ currentUserId, initialPage }: MyPostsListProps) {
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<Page<PostView>>(`/me/posts?cursor=${encodeURIComponent(nextCursor)}`);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err, "投稿を読み込めませんでした"));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="camera"
        title="まだ投稿がありません"
        description="写真を投稿すると、ここに一覧で表示されます。"
        action={
          <ButtonLink href="/posts/new" leftIcon="camera">
            投稿する
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((post) => (
          <li key={post.id}>
            <PostCard post={post} currentUserId={currentUserId} showSpotName />
          </li>
        ))}
      </ul>
      {error ? <ErrorMessage message={error} onRetry={loadMore} retrying={loading} /> : null}
      {nextCursor && !error ? (
        <Button variant="secondary" fullWidth leftIcon="arrow-down" loading={loading} onClick={loadMore}>
          さらに読み込む
        </Button>
      ) : null}
    </div>
  );
}
