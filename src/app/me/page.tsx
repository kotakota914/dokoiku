import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountActions } from "@/components/auth/AccountActions";
import { MyPostsList } from "@/components/auth/MyPostsList";
import { ProfileEditor } from "@/components/auth/ProfileEditor";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/server";
import { LIMITS } from "@/lib/domain/constants";
import { getRepo } from "@/lib/repo";

export const metadata: Metadata = { title: "マイページ" };

/** S-13：マイページ（F-6-3、F-6-4）。未ログインは /login?next=/me、プロフィール未作成は /welcome */
export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fme");
  if (!user.profile) redirect("/welcome?next=%2Fme");
  const profile = user.profile;

  const repo = await getRepo();
  const initialPage = await repo.posts.listByUser(user.id, { limit: LIMITS.postsPageSize }, user.id);

  return (
    <>
      <PageHeader title="マイページ" hideBack />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
        <Card as="section" aria-labelledby="me-profile-heading" className="flex flex-col gap-4">
          <h2 id="me-profile-heading" className="sr-only">
            プロフィール
          </h2>
          <div className="flex items-center gap-4">
            <Avatar src={profile.avatarUrl} name={profile.displayName} size={64} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-lg font-semibold text-text">{profile.displayName}</p>
              {user.isAdmin ? (
                <Badge icon="check" tone="primary">
                  管理者
                </Badge>
              ) : null}
            </div>
          </div>
          <ProfileEditor profile={profile} />
        </Card>

        <section aria-labelledby="me-posts-heading" className="flex flex-col gap-3">
          <h2 id="me-posts-heading" className="text-lg font-semibold text-text">
            自分の投稿
          </h2>
          <MyPostsList currentUserId={user.id} initialPage={initialPage} />
        </section>

        <Card as="section" aria-labelledby="me-account-heading" className="flex flex-col gap-3">
          <h2 id="me-account-heading" className="text-lg font-semibold text-text">
            アカウント
          </h2>
          <AccountActions />
        </Card>
      </div>
    </>
  );
}
