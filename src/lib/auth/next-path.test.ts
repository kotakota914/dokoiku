import { describe, expect, it } from "vitest";
import { isSafeNext, loginUrl, safeNext, welcomeUrl } from "./next-path";

describe("isSafeNext", () => {
  it("同一オリジンのパスだけを許可する", () => {
    expect(isSafeNext("/")).toBe(true);
    expect(isSafeNext("/me")).toBe(true);
    expect(isSafeNext("/lists/abc?tab=plans#x")).toBe(true);
    expect(isSafeNext("/spots/123")).toBe(true);
  });

  it("外部 URL・スキーム相対 URL・制御文字を拒否する", () => {
    expect(isSafeNext("https://evil.example")).toBe(false);
    expect(isSafeNext("//evil.example/path")).toBe(false);
    expect(isSafeNext("/\\evil.example")).toBe(false);
    expect(isSafeNext("/me\r\nSet-Cookie: a=b")).toBe(false);
    expect(isSafeNext("/javascript:alert(1)")).toBe(false);
    expect(isSafeNext("")).toBe(false);
    expect(isSafeNext(undefined)).toBe(false);
    expect(isSafeNext(null)).toBe(false);
    expect(isSafeNext(123)).toBe(false);
    expect(isSafeNext("me")).toBe(false);
  });

  it("ログイン・コールバック自身へのループを防ぐ", () => {
    expect(isSafeNext("/login")).toBe(false);
    expect(isSafeNext("/login?next=/me")).toBe(false);
    expect(isSafeNext("/auth/callback")).toBe(false);
    expect(isSafeNext("/auth/signout")).toBe(false);
    // 前方一致ではなくパス境界で判定する
    expect(isSafeNext("/loginfo")).toBe(true);
    expect(isSafeNext("/authors")).toBe(true);
  });
});

describe("safeNext / URL ヘルパー", () => {
  it("不正なら既定値へ落とす", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(undefined, "/me")).toBe("/me");
    expect(safeNext("/lists")).toBe("/lists");
  });

  it("戻り先付きの URL を作る", () => {
    expect(loginUrl("/")).toBe("/login");
    expect(loginUrl("/me")).toBe("/login?next=%2Fme");
    expect(welcomeUrl("/")).toBe("/welcome");
    expect(welcomeUrl("/lists/1")).toBe("/welcome?next=%2Flists%2F1");
  });
});
