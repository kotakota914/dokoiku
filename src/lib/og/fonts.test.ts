/**
 * OGP 用の日本語フォント取得（Google Fonts からのサブセット）のテスト。fetch はモックする。
 * - CSS の src: url(...) format('truetype') を読んで TTF を返す
 * - 取得に失敗したら空配列（呼び出し側は asciiOnly で英数だけにする）
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { asciiOnly, loadJapaneseFonts, uniqueChars } = await import("./fonts");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uniqueChars / asciiOnly", () => {
  it("重複と空白を除いて文字を並べる", () => {
    expect(uniqueChars(["兼六園 兼六", "園"])).toBe("兼六園");
  });

  it("英数以外を落とし、空なら fallback", () => {
    expect(asciiOnly("兼六園 Kenrokuen (2)", "Spot")).toBe("Kenrokuen (2)");
    expect(asciiOnly("兼六園", "Spot")).toBe("Spot");
  });
});

describe("loadJapaneseFonts", () => {
  it("CSS から TTF の URL を読み、weight ごとのフォントを返す（結果はキャッシュ）", async () => {
    const ttf = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://fonts.googleapis.com/css2")) {
        expect(url).toContain("family=Noto+Sans+JP%3Awght%40700");
        expect(url).toContain("text=");
        return new Response(
          "@font-face { font-family: 'Noto Sans JP'; src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype'); }",
          { status: 200 },
        );
      }
      expect(url).toBe("https://fonts.gstatic.com/l/font?kit=abc");
      return new Response(ttf, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fonts = await loadJapaneseFonts(["テスト-1"], [700]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({ name: "Noto Sans JP", weight: 700, style: "normal" });
    expect(new Uint8Array(fonts[0].data)).toEqual(new Uint8Array([1, 2, 3]));
    await loadJapaneseFonts(["テスト-1"], [700]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("取得に失敗したら空配列を返し、次回は再試行する", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadJapaneseFonts(["失敗する文字列"], [400, 700])).toEqual([]);
    expect(await loadJapaneseFonts(["失敗する文字列"], [400, 700])).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("woff2 しか返らない・ネットワーク例外のときも空配列", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("src: url(https://x/y.woff2) format('woff2');", { status: 200 })),
    );
    expect(await loadJapaneseFonts(["ウェブ"], [700])).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await loadJapaneseFonts(["オフライン"], [700])).toEqual([]);
  });
});
