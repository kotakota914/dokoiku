/**
 * S-11 ログイン（memory モードの開発用ログイン）、S-13 マイページ、ログアウト、ログイン必須ページの誘導。
 */
import { SEED_USERS, expect, test } from "./helpers";

test.describe("認証", () => {
  test("開発用ログイン → マイページ → リスト → ログアウト → リストはログインへ", async ({ page }) => {
    // 未ログインでログイン必須ページを開くとログインへ（戻り先付き）
    await page.goto("/lists");
    await expect(page).toHaveURL(/\/login\?next=%2Flists/);

    // 開発用ログイン（開発ユーザーA）
    await expect(page.getByRole("heading", { name: "開発用ログイン（Supabase 未設定時）" })).toBeVisible();
    await page.getByRole("button", { name: SEED_USERS.userA.displayName }).click();

    // next=/lists へ戻る
    await expect(page).toHaveURL(/\/lists$/);
    await expect(page.getByRole("heading", { name: "行きたい場所リスト" })).toBeVisible();

    // マイページに表示名が出る
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "マイページ" })).toBeVisible();
    const profile = page.getByRole("region", { name: "プロフィール" });
    await expect(profile.getByText(SEED_USERS.userA.displayName, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "自分の投稿" })).toBeVisible();

    // /lists が 200
    const res = await page.goto("/lists");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/lists$/);

    // ログアウト（/me の form POST /auth/signout → 303 で "/" へ）
    await page.goto("/me");
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/$/);

    // ログアウト後はリストを開けない
    await page.goto("/lists");
    await expect(page).toHaveURL(/\/login\?next=%2Flists/);
  });

  test("ログイン済みで /login を開くと next へ戻される", async ({ page }) => {
    await page.goto("/login?next=%2Fme");
    await page.getByRole("button", { name: SEED_USERS.userB.displayName }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(
      page
        .getByRole("region", { name: "プロフィール" })
        .getByText(SEED_USERS.userB.displayName, { exact: true }),
    ).toBeVisible();

    await page.goto("/login?next=%2Flists");
    await expect(page).toHaveURL(/\/lists$/);
  });
});
