"use client";

import Link from "next/link";
import { useState } from "react";
import type { PostView } from "@/lib/domain/types";
import { formatDateTimeJa } from "@/lib/utils/time";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CategoryLabel,
  Icon,
  PhotoImage,
  StayDurationLabel,
  cn,
} from "@/components/ui";
import { LikeButton } from "./LikeButton";
import { ReportDialog } from "./ReportDialog";
import { useRequireLogin } from "./useRequireLogin";

export interface PostCardProps {
  post: PostView;
  /** 閲覧者の ID。null は未ログイン、undefined は不明（サーバーで判定しない場合） */
  currentUserId?: string | null;
  /** マイページなどスポット外で使うときはスポット名へのリンクを出す */
  showSpotName?: boolean;
  className?: string;
}

/** 写真 1〜4 枚のグリッド配置 */
function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  return "grid-cols-2";
}

/** 投稿カード（S-02 投稿一覧、S-13 マイページ共用） */
export function PostCard({ post, currentUserId, showSpotName = false, className }: PostCardProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const requireLogin = useRequireLogin();
  const isOwner = Boolean(currentUserId) && post.userId === currentUserId;
  const images = [...post.images].sort((a, b) => a.sortOrder - b.sortOrder);

  function openReport() {
    if (currentUserId === null) {
      requireLogin();
      return;
    }
    setReportOpen(true);
  }

  return (
    <Card
      as="article"
      flush
      className={cn("flex flex-col overflow-hidden", className)}
      aria-label={`${post.author.displayName}の投稿`}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium text-text">{post.author.displayName}</span>
          <time dateTime={post.createdAt} className="text-base text-text-muted">
            {formatDateTimeJa(post.createdAt)}
          </time>
        </div>
        {post.status === "hidden" ? (
          // 非表示は eye-off（circle-pause は「停止中」専用。docs/decisions.md）
          <Badge icon="eye-off" tone="warning">
            非表示
          </Badge>
        ) : null}
      </header>

      {showSpotName && post.spotName ? (
        <Link
          href={`/spots/${post.spotId}`}
          className="mx-4 mt-3 inline-flex min-h-11 items-center gap-1 self-start rounded-card text-base text-primary-strong hover:underline"
        >
          <Icon name="map-pin" size={16} />
          <span>{post.spotName}</span>
        </Link>
      ) : null}

      {images.length > 0 ? (
        <div className={cn("mt-3 grid gap-0.5", gridClass(images.length))}>
          {images.slice(0, 4).map((img, i) => (
            <PhotoImage
              key={img.id}
              src={img.thumbUrl}
              alt={`${post.author.displayName}の写真 ${i + 1}枚目`}
              category={post.category}
              className={cn("w-full", images.length === 1 ? "aspect-[4/3]" : "aspect-square")}
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        {post.comment ? (
          <p className="whitespace-pre-wrap break-words text-base text-text">{post.comment}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-text-muted">
          <CategoryLabel category={post.category} />
          <StayDurationLabel duration={post.stayDuration} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LikeButton
            postId={post.id}
            likeCount={post.likeCount}
            likedByMe={post.likedByMe}
            currentUserId={currentUserId}
          />
          {isOwner ? (
            <ButtonLink href={`/posts/${post.id}/edit`} variant="secondary" leftIcon="pencil">
              編集
            </ButtonLink>
          ) : (
            <Button variant="ghost" leftIcon="flag" onClick={openReport} className="text-text-muted">
              通報
            </Button>
          )}
        </div>
      </div>

      {!isOwner ? (
        <ReportDialog postId={post.id} open={reportOpen} onClose={() => setReportOpen(false)} />
      ) : null}
    </Card>
  );
}
