import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PostEditForm } from "@/components/post/PostEditForm";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

export const metadata: Metadata = { title: "投稿を編集" };

type Props = { params: Promise<{ postId: string }> };

/** S-05 投稿編集（F-2-12）。本人以外は見つからない扱い（API は 403） */
export default async function EditPostPage({ params }: Props) {
  const { postId } = await params;
  const self = `/posts/${encodeURIComponent(postId)}/edit`;

  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(self));
  if (!user.profile) redirect(welcomeUrl(self));

  const repo = await getRepo();
  const post = await repo.posts.getById(postId, user.id);
  if (!post || post.userId !== user.id) notFound();

  return <PostEditForm post={post} />;
}
