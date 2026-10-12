/**
 * fetch-commons-photos.mjs の純粋関数と、API 応答を模した fetch での処理の確認。
 * 実行: node --test scripts/seed/fetch-commons-photos.test.mjs
 * ネットワークは使わない（fetch を差し替える）。sharp の変換は、この場で生成した PNG で実際に動かす。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  isAcceptableLicense,
  inferSeason,
  inferTimeOfDay,
  stripHtml,
  sourceUrlOf,
  toCandidate,
  selectDiverse,
  mergePhotos,
  nextIndex,
  renderCredits,
  parseArgs,
  createCommonsClient,
  processSpot,
} from "./fetch-commons-photos.mjs";

test("ライセンス判定: CC0 / CC BY / CC BY-SA / Public domain は採用、NC / ND は不採用", () => {
  for (const ok of [
    "CC0",
    "CC0 1.0",
    "CC BY 2.0",
    "CC BY 3.0",
    "CC BY 4.0",
    "CC BY-SA 2.0",
    "CC BY-SA 3.0",
    "CC BY-SA 4.0",
    "Public domain",
  ]) {
    assert.equal(isAcceptableLicense(ok), true, ok);
  }
  for (const ng of [
    "CC BY-NC 4.0",
    "CC BY-ND 4.0",
    "CC BY-NC-SA 3.0",
    "CC BY-NC-ND 2.0",
    "GFDL",
    "Fair use",
    "",
    undefined,
    "CC BY 1.0",
    "CC BY-SA 5.0",
  ]) {
    assert.equal(isAcceptableLicense(ng), false, String(ng));
  }
});

test("season / timeOfDay の推定", () => {
  assert.equal(inferSeason("Kenrokuen in snow, yukitsuri"), "winter");
  assert.equal(inferSeason("兼六園の桜"), "spring");
  assert.equal(inferSeason("Autumn leaves at Kenrokuen"), "autumn");
  assert.equal(inferSeason("Kenrokuen in summer"), "summer");
  assert.equal(inferSeason("Kenrokuen waterfall"), null, "waterfall を fall と誤認しない");
  assert.equal(inferTimeOfDay("兼六園 ライトアップ"), "night");
  assert.equal(inferTimeOfDay("Kanazawa Castle at night"), "night");
  assert.equal(inferTimeOfDay("Kanazawa Castle"), "day");
});

test("作者の HTML をテキスト化、出典 URL を作る", () => {
  assert.equal(
    stripHtml('<a href="//commons.wikimedia.org/wiki/User:Foo">Foo Bar</a> &amp; Baz'),
    "Foo Bar & Baz",
  );
  assert.equal(
    sourceUrlOf("File:Kenrokuen 01.jpg"),
    "https://commons.wikimedia.org/wiki/File:Kenrokuen_01.jpg",
  );
});

function page(
  title,
  {
    license = "CC BY-SA 4.0",
    mime = "image/jpeg",
    width = 2400,
    height = 1600,
    desc = "",
    cats = "",
    artist = "Alice",
  } = {},
) {
  return {
    title,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`,
        thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`,
        width,
        height,
        mime,
        extmetadata: {
          LicenseShortName: { value: license },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
          Artist: { value: `<a href="#">${artist}</a>` },
          ImageDescription: { value: desc },
          Categories: { value: cats },
        },
      },
    ],
  };
}

test("toCandidate は採用条件を満たすものだけ返す", () => {
  assert.ok(toCandidate(page("File:A.jpg")));
  assert.equal(toCandidate(page("File:B.jpg", { license: "CC BY-NC 2.0" })), null);
  assert.equal(toCandidate(page("File:C.svg", { mime: "image/svg+xml" })), null);
  assert.equal(toCandidate(page("File:D.jpg", { width: 640 })), null);
  const c = toCandidate(page("File:E.jpg", { desc: "Night illumination in winter", artist: "Bob" }));
  assert.equal(c.author, "Bob");
  assert.equal(c.season, "winter");
  assert.equal(c.timeOfDay, "night");
});

test("selectDiverse は季節・時間帯の組み合わせが異なるものを優先する", () => {
  const cands = [
    toCandidate(page("File:1.jpg", { desc: "spring" })),
    toCandidate(page("File:2.jpg", { desc: "spring", width: 3000 })),
    toCandidate(page("File:3.jpg", { desc: "winter night" })),
    toCandidate(page("File:4.jpg", { desc: "autumn" })),
    toCandidate(page("File:5.jpg", { desc: "winter night", width: 4000 })),
  ];
  const picked = selectDiverse(cands, 3);
  const combos = picked.map((c) => `${c.season}/${c.timeOfDay}`);
  assert.deepEqual(new Set(combos).size, 3);
  assert.ok(
    combos.includes("spring/day") && combos.includes("winter/night") && combos.includes("autumn/day"),
  );
  // 除外（既に取得済みの出典）
  const picked2 = selectDiverse(cands, 5, new Set([cands[0].sourceUrl]));
  assert.equal(picked2.length, 4);
});

test("mergePhotos は同じ fullPath を上書きし、nextIndex は続きの番号を返す", () => {
  const a = { spotKey: "k", file: "1.webp", fullPath: "seed/photos/k/1.webp" };
  const b = { spotKey: "k", file: "2.webp", fullPath: "seed/photos/k/2.webp" };
  const a2 = { ...a, title: "new" };
  const merged = mergePhotos([a, b], [a2]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((p) => p.file === "1.webp").title, "new");
  assert.equal(nextIndex(merged, "k"), 3);
  assert.equal(nextIndex(merged, "other"), 1);
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs([]), { spot: null, perSpot: 4, dryRun: false, overwrite: false });
  assert.deepEqual(parseArgs(["--spot", "kenrokuen", "--per-spot", "6", "--dry-run", "--overwrite"]), {
    spot: "kenrokuen",
    perSpot: 6,
    dryRun: true,
    overwrite: true,
  });
  assert.throws(() => parseArgs(["--per-spot", "0"]));
  assert.throws(() => parseArgs(["--unknown"]));
});

test("API 応答を模した fetch で processSpot が photos.json の形の行を返し、WebP を保存する", async () => {
  const png = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: { r: 120, g: 160, b: 200 } },
  })
    .png()
    .toBuffer();
  const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
  const fakeFetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === "commons.wikimedia.org") {
      const list = u.searchParams.get("list");
      if (list === "categorymembers")
        return jsonRes({
          query: { categorymembers: [{ title: "File:Cat 1.jpg" }, { title: "File:Cat 2.jpg" }] },
        });
      if (list === "search")
        return jsonRes({ query: { search: [{ title: "File:Cat 2.jpg" }, { title: "File:Search 3.png" }] } });
      if (u.searchParams.get("prop") === "imageinfo") {
        const titles = u.searchParams.get("titles").split("|");
        assert.equal(titles.length, 3, "タイトルは重複なしでまとめて問い合わせる");
        return jsonRes({
          query: {
            pages: [
              page("File:Cat 1.jpg", { desc: "Kenrokuen in winter", license: "CC BY 4.0" }),
              page("File:Cat 2.jpg", { desc: "night view", license: "CC BY-NC 4.0" }),
              page("File:Search 3.png", { mime: "image/png", desc: "桜", license: "CC0" }),
            ],
          },
        });
      }
    }
    if (u.hostname === "upload.wikimedia.org") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dokoiku-photos-"));
  try {
    const client = createCommonsClient({ fetchImpl: fakeFetch, intervalMs: 0 });
    const spot = {
      key: "kenrokuen",
      name: "兼六園",
      commons: { categories: ["Kenroku-en"], search: ["Kenrokuen"] },
    };
    const { entries } = await processSpot(spot, {
      client,
      photosDir: dir,
      existing: [],
      perSpot: 4,
      dryRun: false,
      overwrite: false,
    });
    assert.equal(entries.length, 2, "NC は除外される");
    const e = entries[0];
    assert.deepEqual(Object.keys(e), [
      "spotKey",
      "file",
      "fullPath",
      "thumbPath",
      "width",
      "height",
      "title",
      "author",
      "license",
      "licenseUrl",
      "sourceUrl",
      "season",
      "timeOfDay",
    ]);
    assert.equal(e.spotKey, "kenrokuen");
    assert.equal(e.fullPath, "seed/photos/kenrokuen/1.webp");
    assert.equal(e.thumbPath, "seed/photos/kenrokuen/1_t.webp");
    assert.equal(e.width, 1600);
    assert.equal(e.height, 1200);
    assert.match(e.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.equal(e.author, "Alice");

    const full = await sharp(path.join(dir, "kenrokuen", "1.webp")).metadata();
    const thumb = await sharp(path.join(dir, "kenrokuen", "1_t.webp")).metadata();
    assert.equal(full.format, "webp");
    assert.equal(full.width, 1600);
    assert.equal(thumb.width, 400);
    assert.equal(full.exif, undefined, "EXIF は残さない");

    // 2 回目は既に取得した出典を飛ばし、番号は続きになる
    const second = await processSpot(spot, {
      client,
      photosDir: dir,
      existing: mergePhotos([], entries),
      perSpot: 4,
      dryRun: false,
      overwrite: false,
    });
    assert.equal(second.entries.length, 0);
    assert.equal(nextIndex(mergePhotos([], entries), "kenrokuen"), 3);

    const md = renderCredits(entries, [spot]);
    assert.match(md, /## 兼六園（`kenrokuen`）/);
    assert.match(md, /\| 1\.webp \| Alice \| \[CC BY 4\.0\]/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
