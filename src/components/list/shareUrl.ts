/**
 * 共有 URL（F-4-6）の組み立て。ブラウザの origin を使う（serverConfig.siteUrl は使わない）。
 * 純粋関数はテストしやすいように分けている。
 */

/** POST /lists/{id}/share のレスポンス。API 担当には { shareToken, url } を依頼済みだが token だけでも動くようにする */
export interface ShareResponse {
  shareToken?: string | null;
  token?: string | null;
  url?: string | null;
}

export function sharePath(token: string): string {
  return `/shared/${encodeURIComponent(token)}`;
}

/** origin（例：https://example.com）と token から共有 URL を作る */
export function buildShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${sharePath(token)}`;
}

/** レスポンスから token を取り出す。url しか無ければ末尾のパスから読む */
export function shareTokenOf(res: ShareResponse | null | undefined): string | null {
  if (!res) return null;
  if (res.shareToken) return res.shareToken;
  if (res.token) return res.token;
  if (res.url) {
    const last = res.url.split("?")[0].split("#")[0].split("/").filter(Boolean).pop();
    if (last) {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    }
  }
  return null;
}
