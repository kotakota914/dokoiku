/**
 * import-posts.mjs の純粋関数（CSV 解析、検証、EXIF フォールバック）の確認。
 * 実行: node --test scripts/seed/import-posts.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  parseCsv,
  validateRow,
  resolveLocation,
  resolveTakenAt,
  parseArgs,
  convertImage,
  DEFAULT_DEV_USER_ID,
} from "./import-posts.mjs";

test('parseCsv: BOM、CRLF、引用符内のカンマと改行、"" を扱う', () => {
  const text =
    "﻿file,spot,category,stay,comment,lat,lng,taken_at\r\n" +
    'a.jpg,兼六園,nature,lt120,"霞ヶ池, 午前がよい",,,\r\n' +
    'b.jpg,"金沢工業大学 ""ラテラ""",gourmet,,"2 行目\n続き",36.53,136.63,2026-10-05T14:30:00+09:00\r\n' +
    "\r\n";
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].file, "a.jpg");
  assert.equal(rows[0].comment, "霞ヶ池, 午前がよい");
  assert.equal(rows[0].lat, "");
  assert.equal(rows[0]._line, 2);
  assert.equal(rows[1].spot, '金沢工業大学 "ラテラ"');
  assert.equal(rows[1].comment, "2 行目\n続き");
  assert.equal(rows[1].lat, "36.53");
  assert.equal(rows[1].taken_at, "2026-10-05T14:30:00+09:00");
});

test("validateRow: 正常系と異常系", () => {
  const ok = validateRow({
    _line: 2,
    file: "a.jpg",
    spot: "兼六園",
    category: "nature",
    stay: "lt60",
    comment: "よい",
    lat: "36.56",
    lng: "136.66",
    taken_at: "2026-10-05T14:30:00+09:00",
  });
  assert.equal(ok.errors, undefined);
  assert.equal(ok.lat, 36.56);
  assert.equal(ok.stayDuration, "lt60");
  assert.equal(ok.takenAt, "2026-10-05T05:30:00.000Z");

  const empty = validateRow({
    _line: 3,
    file: "b.jpg",
    spot: "兼六園",
    category: "nature",
    stay: "",
    comment: "",
    lat: "",
    lng: "",
    taken_at: "",
  });
  assert.equal(empty.errors, undefined);
  assert.equal(empty.lat, null);
  assert.equal(empty.stayDuration, null);
  assert.equal(empty.takenAt, null);

  const bad = validateRow({
    _line: 4,
    file: "",
    spot: "x".repeat(51),
    category: "food",
    stay: "long",
    comment: "y".repeat(151),
    lat: "91",
    lng: "",
    taken_at: "きのう",
  });
  assert.ok(bad.errors.length >= 7, bad.errors.join("\n"));
});

test("resolveLocation: CSV → EXIF → 既存スポット の順", () => {
  const exif = { latitude: 36.5, longitude: 136.6 };
  const spot = { lat: 36.1, lng: 136.1 };
  assert.deepEqual(resolveLocation({ lat: 36.9, lng: 136.9 }, exif, spot), {
    lat: 36.9,
    lng: 136.9,
    from: "csv",
  });
  assert.deepEqual(resolveLocation({ lat: null, lng: null }, exif, spot), {
    lat: 36.5,
    lng: 136.6,
    from: "exif",
  });
  assert.deepEqual(resolveLocation({ lat: null, lng: null }, null, spot), {
    lat: 36.1,
    lng: 136.1,
    from: "spot",
  });
  assert.deepEqual(resolveLocation({ lat: null, lng: null }, { latitude: undefined }, spot), {
    lat: 36.1,
    lng: 136.1,
    from: "spot",
  });
  assert.equal(resolveLocation({ lat: null, lng: null }, null, null), null);
});

test("resolveTakenAt: CSV → EXIF の DateTimeOriginal", () => {
  assert.equal(
    resolveTakenAt(
      { takenAt: "2026-10-05T05:30:00.000Z" },
      { DateTimeOriginal: new Date("2020-01-01T00:00:00Z") },
    ),
    "2026-10-05T05:30:00.000Z",
  );
  assert.equal(
    resolveTakenAt({ takenAt: null }, { DateTimeOriginal: new Date("2020-01-01T00:00:00Z") }),
    "2020-01-01T00:00:00.000Z",
  );
  assert.equal(
    resolveTakenAt({ takenAt: null }, { DateTimeOriginal: "2020:01:02 03:04:05" }),
    new Date("2020-01-02T03:04:05").toISOString(),
  );
  assert.equal(resolveTakenAt({ takenAt: null }, null), null);
});

test("parseArgs", () => {
  const a = parseArgs(["--photos", "./p", "--csv", "./p/list.csv"]);
  assert.equal(a.target, "memory");
  assert.equal(a.user, DEFAULT_DEV_USER_ID);
  assert.equal(a.baseUrl, "http://localhost:3000");
  const b = parseArgs([
    "--photos=./p",
    "--csv=./l.csv",
    "--target",
    "supabase",
    "--user",
    "u1",
    "--base-url",
    "http://x/",
    "--dry-run",
  ]);
  assert.equal(b.target, "supabase");
  assert.equal(b.user, "u1");
  assert.equal(b.baseUrl, "http://x");
  assert.equal(b.dryRun, true);
  assert.throws(() => parseArgs(["--photos", "./p"]), /--csv/);
  assert.throws(() => parseArgs(["--photos", "./p", "--csv", "./c", "--target", "supabase"]), /--user/);
  assert.throws(() => parseArgs(["--photos", "./p", "--csv", "./c", "--target", "x"]));
});

test("convertImage: 1600 / 400 の WebP を作り EXIF を残さない", async () => {
  const jpeg = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 80 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "test", Software: "test" } } })
    .toBuffer();
  const out = await convertImage(jpeg);
  assert.equal(out.width, 1600);
  assert.equal(out.height, 1067);
  const full = await sharp(out.full).metadata();
  const thumb = await sharp(out.thumb).metadata();
  assert.equal(full.format, "webp");
  assert.equal(full.exif, undefined);
  assert.equal(thumb.width, 400);
});
