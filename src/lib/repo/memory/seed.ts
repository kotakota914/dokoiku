/**
 * memory モードの初期データ（Q16）。京都市内の実在スポット約40件と開発用ユーザー3人。
 * buildSeedData() は決定的（乱数は固定シードの PRNG）で、毎回同じデータを返す。
 * 画像は "seed/<spotId>/<n>.svg" というパスで、/api/dev/files がプレースホルダー SVG を生成する。
 */
import type { Category, StayDuration } from "@/lib/domain/constants";
import type { Post, Profile, Spot } from "@/lib/domain/types";
import { computeSpotStats, type LikeRow, type StoredImage } from "./model";

export interface SeedData {
  profiles: Profile[];
  spots: Spot[];
  posts: Post[];
  images: StoredImage[];
  likes: LikeRow[];
}

/** 開発用ユーザーの固定 ID（テストと /api/dev/login で使う） */
export const SEED_USER_IDS = {
  userA: "a0000000-0000-4000-8000-000000000001",
  userB: "a0000000-0000-4000-8000-000000000002",
  admin: "a0000000-0000-4000-8000-000000000003",
} as const;

export const SEED_USER_ID_LIST: readonly string[] = [
  SEED_USER_IDS.userA,
  SEED_USER_IDS.userB,
  SEED_USER_IDS.admin,
];

const SEED_PROFILE_CREATED_AT = "2026-04-01T09:00:00.000+09:00";

const SEED_PROFILES: Profile[] = [
  {
    id: SEED_USER_IDS.userA,
    displayName: "開発ユーザーA",
    avatarUrl: null,
    isAdmin: false,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
  {
    id: SEED_USER_IDS.userB,
    displayName: "開発ユーザーB",
    avatarUrl: null,
    isAdmin: false,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
  {
    id: SEED_USER_IDS.admin,
    displayName: "管理者ユーザー",
    avatarUrl: null,
    isAdmin: true,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
];

/** 投稿時刻の傾向。配列から一様に選ぶことで重みを付ける */
type HourProfile = "morning" | "day" | "evening" | "night" | "lunch";
const HOUR_PROFILES: Record<HourProfile, number[]> = {
  morning: [6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 11, 15],
  day: [9, 10, 10, 11, 11, 12, 13, 13, 14, 14, 15, 15, 16, 17],
  evening: [12, 14, 15, 16, 16, 17, 17, 17, 18, 18, 18, 19],
  night: [17, 18, 19, 19, 20, 20, 20, 21, 21, 22],
  lunch: [10, 11, 11, 12, 12, 12, 13, 13, 14, 15],
};

/** 滞在時間の傾向 */
type StayProfile = "quick" | "hour" | "long" | "half";
const STAY_PROFILES: Record<StayProfile, (StayDuration | null)[]> = {
  quick: ["lt30", "lt30", "lt30", "lt60", null],
  hour: ["lt60", "lt60", "lt60", "lt30", "lt120", null],
  long: ["lt120", "lt120", "lt60", "lt120", "half_day", null],
  half: ["half_day", "half_day", "lt120", "lt120", null],
};

/** 投稿カテゴリのゆらぎ（スポットのカテゴリと違うものを少数混ぜる） */
const ALT_CATEGORY: Record<Category, Category> = {
  nature: "photogenic",
  gourmet: "other",
  history: "photogenic",
  photogenic: "nature",
  other: "photogenic",
};

/** カテゴリ共通のコメント（スポット固有のコメントを使い切ったあとに使う） */
const GENERIC_COMMENTS: Record<Category, string[]> = {
  nature: [
    "午前中は光がやわらかくて散策にちょうどいいです",
    "雨上がりは緑が濃くなってきれいでした",
    "歩きやすい靴で来るのがおすすめです",
    "ベンチが少ないので休憩は早めに取るのがよさそう",
    "季節で表情が変わるので何度来ても楽しめます",
    "夏は虫よけがあると安心です",
  ],
  gourmet: [
    "昼どきは行列になるので開店直後が狙い目です",
    "現金しか使えない店があるので小銭を用意しておくと安心",
    "食べ歩きは店の前で食べるのがマナーです",
    "夕方には売り切れるものが多いので早めに",
    "一人でも入りやすい雰囲気でした",
  ],
  history: [
    "拝観受付は閉まるのが早いので時間に注意",
    "御朱印は混む前の午前中がスムーズです",
    "音声ガイドを借りると見どころが分かりやすいです",
    "紅葉の時期は入場まで30分ほど待ちました",
    "庭園をゆっくり見るなら1時間は見ておいた方がいいです",
    "団体客が来る前の朝が静かでおすすめです",
  ],
  photogenic: [
    "逆光になりにくい午後が撮りやすかったです",
    "三脚は使えないので手持ちで撮りました",
    "人が入らない構図を狙うなら早朝一択です",
    "雨の日は反射が入ってむしろ良い写真が撮れます",
    "夕暮れの30分だけ空の色が特別です",
  ],
  other: [
    "トイレは入口近くにあります",
    "コインロッカーがあるので荷物を預けてから回れます",
    "休日は混むので平日の方が落ち着いて楽しめます",
    "屋根があるので雨の日の予定にも入れやすいです",
  ],
};

interface SpotSeed {
  name: string;
  lat: number;
  lng: number;
  category: Category;
  city: string;
  address: string;
  posts: number;
  hours: HourProfile;
  stay: StayProfile;
  comments: string[];
}

const PREFECTURE = "京都府";

const SPOT_SEEDS: SpotSeed[] = [
  {
    name: "清水寺",
    lat: 34.9949,
    lng: 135.785,
    category: "history",
    city: "京都市東山区",
    address: "清水1丁目294",
    posts: 24,
    hours: "morning",
    stay: "long",
    comments: [
      "開門の6時に入ると舞台がほぼ貸し切りでした",
      "清水坂は帰りに寄ると土産物屋がちょうど開いています",
      "舞台からの眺めは午前中の順光が一番きれいです",
      "音羽の滝は昼前から列ができるので先に回るのがおすすめ",
    ],
  },
  {
    name: "伏見稲荷大社",
    lat: 34.9671,
    lng: 135.7727,
    category: "history",
    city: "京都市伏見区",
    address: "深草藪之内町68",
    posts: 25,
    hours: "morning",
    stay: "long",
    comments: [
      "朝7時前なら人が少なくて千本鳥居がきれいに撮れます",
      "山頂まで往復2時間ほど。四ツ辻で引き返す人が多いです",
      "参道の屋台は10時ごろから開き始めます",
      "夕方以降は灯籠に明かりが入って雰囲気が変わります",
    ],
  },
  {
    name: "金閣寺",
    lat: 35.0394,
    lng: 135.7292,
    category: "history",
    city: "京都市北区",
    address: "金閣寺町1",
    posts: 21,
    hours: "day",
    stay: "hour",
    comments: [
      "鏡湖池の正面は午前中の方が金色がはっきり映ります",
      "順路が一方通行なので見逃すと戻れません",
      "雪の日は開門前から行列ができます",
    ],
  },
  {
    name: "嵐山 竹林の小径",
    lat: 35.017,
    lng: 135.6717,
    category: "nature",
    city: "京都市右京区",
    address: "嵯峨天龍寺芒ノ馬場町",
    posts: 18,
    hours: "morning",
    stay: "quick",
    comments: [
      "8時前に着けば人のいない竹林を歩けます",
      "野宮神社側から入るとなだらかで歩きやすいです",
      "人力車が通るので端に寄って撮影するとよいです",
    ],
  },
  {
    name: "鴨川デルタ",
    lat: 35.0302,
    lng: 135.7726,
    category: "nature",
    city: "京都市左京区",
    address: "下鴨宮河町",
    posts: 12,
    hours: "evening",
    stay: "hour",
    comments: [
      "飛び石は増水後は渡れないことがあるので足元に注意",
      "夕方は川沿いに座ってのんびりする人で賑わいます",
      "出町柳駅から徒歩3分なので待ち合わせにも使えます",
    ],
  },
  {
    name: "錦市場",
    lat: 35.005,
    lng: 135.7649,
    category: "gourmet",
    city: "京都市中京区",
    address: "錦小路通富小路西入ル",
    posts: 15,
    hours: "lunch",
    stay: "hour",
    comments: [
      "だし巻きや豆乳ドーナツなど食べ歩きが楽しいです",
      "10時すぎが開店直後で歩きやすいです",
      "通りが狭いので大きな荷物は預けてから",
    ],
  },
  {
    name: "二条城",
    lat: 35.0142,
    lng: 135.7481,
    category: "history",
    city: "京都市中京区",
    address: "二条城町541",
    posts: 10,
    hours: "day",
    stay: "long",
    comments: [
      "二の丸御殿のうぐいす張りは静かな時間帯だとよく聞こえます",
      "庭園まで含めると1時間半は見ておいた方がいいです",
    ],
  },
  {
    name: "哲学の道",
    lat: 35.0268,
    lng: 135.7953,
    category: "nature",
    city: "京都市左京区",
    address: "鹿ケ谷法然院町",
    posts: 8,
    hours: "morning",
    stay: "hour",
    comments: ["銀閣寺から南禅寺方面へ歩くと緩い下りで楽です", "桜の時期は朝8時でも人が多いです"],
  },
  {
    name: "祇園白川",
    lat: 35.0053,
    lng: 135.7746,
    category: "photogenic",
    city: "京都市東山区",
    address: "末吉町",
    posts: 14,
    hours: "evening",
    stay: "quick",
    comments: [
      "巽橋のあたりは夕方の灯りがともる頃が一番きれいです",
      "私道の撮影禁止エリアがあるので看板を確認してください",
      "川沿いの柳が風に揺れる様子を撮るなら夕方がおすすめ",
    ],
  },
  {
    name: "八坂神社",
    lat: 35.0037,
    lng: 135.7786,
    category: "history",
    city: "京都市東山区",
    address: "祇園町北側625",
    posts: 13,
    hours: "night",
    stay: "quick",
    comments: [
      "夜は提灯に明かりが入って昼とは別の雰囲気です",
      "四条通の突き当たりなので河原町から歩いて行けます",
      "境内は24時間開いているので遅い時間でも参拝できます",
    ],
  },
  {
    name: "南禅寺",
    lat: 35.0113,
    lng: 135.7937,
    category: "history",
    city: "京都市左京区",
    address: "南禅寺福地町",
    posts: 4,
    hours: "day",
    stay: "hour",
    comments: ["水路閣はレンガのアーチ越しに撮ると奥行きが出ます", "三門の上に登ると市内が一望できます"],
  },
  {
    name: "平安神宮",
    lat: 35.0162,
    lng: 135.7823,
    category: "history",
    city: "京都市左京区",
    address: "岡崎西天王町97",
    posts: 4,
    hours: "day",
    stay: "hour",
    comments: ["大鳥居は岡崎公園側から見上げると大きさが伝わります", "神苑のしだれ桜は4月上旬が見頃です"],
  },
  {
    name: "京都御苑",
    lat: 35.0254,
    lng: 135.7622,
    category: "nature",
    city: "京都市上京区",
    address: "京都御苑3",
    posts: 3,
    hours: "morning",
    stay: "hour",
    comments: ["砂利道が広いので朝の散歩にちょうどいいです", "御所の参観は事前申込なしで入れる日があります"],
  },
  {
    name: "東寺",
    lat: 34.9807,
    lng: 135.7476,
    category: "history",
    city: "京都市南区",
    address: "九条町1",
    posts: 3,
    hours: "evening",
    stay: "hour",
    comments: ["五重塔は夕方の西日で立体感が出ます", "毎月21日の弘法市は朝早くから賑わいます"],
  },
  {
    name: "三十三間堂",
    lat: 34.9878,
    lng: 135.7717,
    category: "history",
    city: "京都市東山区",
    address: "三十三間堂廻り657",
    posts: 4,
    hours: "day",
    stay: "quick",
    comments: ["堂内は撮影禁止なので目に焼き付けてください", "京都国立博物館と合わせて回ると効率がいいです"],
  },
  {
    name: "京都タワー",
    lat: 34.9875,
    lng: 135.7592,
    category: "photogenic",
    city: "京都市下京区",
    address: "東塩小路町721-1",
    posts: 9,
    hours: "night",
    stay: "quick",
    comments: [
      "夜は京都駅前の広場からライトアップが撮れます",
      "展望室は夕暮れ前に上ると昼と夜景の両方が見られます",
      "駅ビルの大階段から撮ると全体が収まります",
    ],
  },
  {
    name: "貴船神社",
    lat: 35.1218,
    lng: 135.7628,
    category: "nature",
    city: "京都市左京区",
    address: "鞍馬貴船町180",
    posts: 4,
    hours: "day",
    stay: "long",
    comments: ["参道の赤い灯籠は雨の日が一番きれいに見えます", "夏は川床が出て市内より5度ほど涼しいです"],
  },
  {
    name: "下鴨神社",
    lat: 35.0389,
    lng: 135.7728,
    category: "history",
    city: "京都市左京区",
    address: "下鴨泉川町59",
    posts: 4,
    hours: "morning",
    stay: "hour",
    comments: ["糺の森の参道は朝の木漏れ日がきれいです", "楼門前のみたらし団子の店は午前中が空いています"],
  },
  {
    name: "上賀茂神社",
    lat: 35.06,
    lng: 135.7527,
    category: "history",
    city: "京都市北区",
    address: "上賀茂本山339",
    posts: 3,
    hours: "morning",
    stay: "hour",
    comments: ["立砂の前は朝だと人が少なくて撮りやすいです", "日曜の手づくり市は掘り出し物が多いです"],
  },
  {
    name: "天龍寺",
    lat: 35.0158,
    lng: 135.6737,
    category: "history",
    city: "京都市右京区",
    address: "嵯峨天龍寺芒ノ馬場町68",
    posts: 4,
    hours: "day",
    stay: "hour",
    comments: [
      "曹源池庭園は嵐山を借景にしていて午前の光が合います",
      "北門から出るとそのまま竹林に抜けられます",
    ],
  },
  {
    name: "渡月橋",
    lat: 35.0128,
    lng: 135.6777,
    category: "photogenic",
    city: "京都市右京区",
    address: "嵯峨中ノ島町",
    posts: 11,
    hours: "evening",
    stay: "quick",
    comments: [
      "橋の南側の河原から山を背景に撮るのが定番です",
      "夕方は観光客が減って落ち着いた写真が撮れます",
      "紅葉シーズンの週末は橋の上が渋滞します",
    ],
  },
  {
    name: "建仁寺",
    lat: 35.0007,
    lng: 135.7736,
    category: "history",
    city: "京都市東山区",
    address: "大和大路通四条下る小松町584",
    posts: 3,
    hours: "day",
    stay: "hour",
    comments: ["風神雷神図のレプリカは至近距離で見られます", "祇園のすぐ裏なので観光の合間に寄りやすいです"],
  },
  {
    name: "知恩院",
    lat: 35.0055,
    lng: 135.7826,
    category: "history",
    city: "京都市東山区",
    address: "林下町400",
    posts: 3,
    hours: "day",
    stay: "hour",
    comments: ["三門の大きさは下から見上げると圧倒されます", "御影堂までの階段が急なので足元に注意"],
  },
  {
    name: "銀閣寺",
    lat: 35.027,
    lng: 135.7982,
    category: "history",
    city: "京都市左京区",
    address: "銀閣寺町2",
    posts: 6,
    hours: "day",
    stay: "hour",
    comments: [
      "銀沙灘と向月台は午後に影が出て形がよく見えます",
      "裏山の展望所まで登ると庭園全体を見下ろせます",
    ],
  },
  {
    name: "北野天満宮",
    lat: 35.0274,
    lng: 135.7353,
    category: "history",
    city: "京都市上京区",
    address: "馬喰町",
    posts: 4,
    hours: "morning",
    stay: "hour",
    comments: ["梅苑は2月から3月上旬が見頃です", "毎月25日の天神市は朝から屋台が並びます"],
  },
  {
    name: "龍安寺",
    lat: 35.0345,
    lng: 135.7183,
    category: "history",
    city: "京都市右京区",
    address: "龍安寺御陵ノ下町13",
    posts: 4,
    hours: "morning",
    stay: "hour",
    comments: ["石庭は開門直後が静かで縁側に座ってゆっくりできます", "鏡容池の周りは散歩道になっています"],
  },
  {
    name: "仁和寺",
    lat: 35.031,
    lng: 135.7138,
    category: "history",
    city: "京都市右京区",
    address: "御室大内33",
    posts: 3,
    hours: "day",
    stay: "hour",
    comments: [
      "御室桜は背が低くて目線の高さで花が見られます",
      "二王門から金堂まで距離があるので時間に余裕を",
    ],
  },
  {
    name: "東福寺",
    lat: 34.9763,
    lng: 135.7738,
    category: "nature",
    city: "京都市東山区",
    address: "本町15丁目778",
    posts: 4,
    hours: "day",
    stay: "hour",
    comments: ["通天橋からの紅葉は11月下旬がピークです", "青もみじの季節は人が少なくて穴場です"],
  },
  {
    name: "平等院",
    lat: 34.8893,
    lng: 135.8078,
    category: "history",
    city: "宇治市",
    address: "宇治蓮華116",
    posts: 5,
    hours: "day",
    stay: "long",
    comments: ["鳳凰堂の内部拝観は時間指定なので先に受付を", "参道の抹茶スイーツは帰りに寄るのがおすすめ"],
  },
  {
    name: "伏見の酒蔵",
    lat: 34.9292,
    lng: 135.7597,
    category: "gourmet",
    city: "京都市伏見区",
    address: "南浜町247",
    posts: 4,
    hours: "lunch",
    stay: "hour",
    comments: ["記念館の見学後に利き酒ができます", "宇治川派流沿いの柳並木は散歩にちょうどいいです"],
  },
  {
    name: "先斗町",
    lat: 35.0066,
    lng: 135.7709,
    category: "gourmet",
    city: "京都市中京区",
    address: "先斗町通四条上ル",
    posts: 10,
    hours: "night",
    stay: "long",
    comments: [
      "夏は鴨川の納涼床で食事ができます",
      "細い路地なので夜は提灯を目印に歩くと迷いません",
      "予約なしだと週末は入れない店が多いです",
    ],
  },
  {
    name: "新京極商店街",
    lat: 35.0063,
    lng: 135.7673,
    category: "other",
    city: "京都市中京区",
    address: "新京極通四条上ル",
    posts: 3,
    hours: "evening",
    stay: "hour",
    comments: ["修学旅行の土産選びはここが定番です", "アーケードなので雨でも歩けます"],
  },
  {
    name: "京都水族館",
    lat: 34.9879,
    lng: 135.7467,
    category: "other",
    city: "京都市下京区",
    address: "観喜寺町35-1",
    posts: 4,
    hours: "day",
    stay: "long",
    comments: [
      "イルカショーは開始15分前に席を取ると見やすいです",
      "京都駅から徒歩15分、梅小路公園の中にあります",
    ],
  },
  {
    name: "梅小路公園",
    lat: 34.9867,
    lng: 135.7432,
    category: "nature",
    city: "京都市下京区",
    address: "観喜寺町56-3",
    posts: 2,
    hours: "day",
    stay: "hour",
    comments: ["芝生広場が広くて子ども連れでものんびりできます"],
  },
  {
    name: "京都国立博物館",
    lat: 34.9898,
    lng: 135.7731,
    category: "history",
    city: "京都市東山区",
    address: "茶屋町527",
    posts: 2,
    hours: "day",
    stay: "long",
    comments: ["特別展は入場待ちがあるので午前中に入るのがおすすめ"],
  },
  {
    name: "将軍塚青龍殿",
    lat: 35.001,
    lng: 135.7893,
    category: "photogenic",
    city: "京都市山科区",
    address: "厨子奥花鳥町28",
    posts: 5,
    hours: "night",
    stay: "quick",
    comments: ["大舞台からの夜景は市内で一番広く見えます", "バスの本数が少ないのでタクシーか車が無難です"],
  },
  {
    name: "蹴上インクライン",
    lat: 35.0113,
    lng: 135.7893,
    category: "photogenic",
    city: "京都市東山区",
    address: "東小物座町",
    posts: 7,
    hours: "morning",
    stay: "quick",
    comments: [
      "桜のトンネルは4月初旬の朝7時が人も少なくておすすめ",
      "線路の上を歩けるので奥行きのある写真が撮れます",
      "南禅寺まで歩いて10分ほどです",
    ],
  },
  {
    name: "京都駅ビル",
    lat: 34.9858,
    lng: 135.7588,
    category: "other",
    city: "京都市下京区",
    address: "東塩小路町901",
    posts: 4,
    hours: "evening",
    stay: "quick",
    comments: ["大階段は夕方からライトアップが始まります", "屋上の空中径路は無料で夜景が見られます"],
  },
  {
    name: "河原町",
    lat: 35.0039,
    lng: 135.7692,
    category: "other",
    city: "京都市中京区",
    address: "河原町通四条上ル",
    posts: 2,
    hours: "evening",
    stay: "hour",
    comments: ["買い物と食事はこのあたりに集まっています"],
  },
  {
    name: "出町ふたば",
    lat: 35.03,
    lng: 135.77,
    category: "gourmet",
    city: "京都市上京区",
    address: "青龍町236",
    posts: 6,
    hours: "lunch",
    stay: "quick",
    comments: ["豆餅は午前中に並ぶと20分ほどで買えます", "すぐ近くの鴨川デルタで食べるのが定番です"],
  },
  {
    name: "錦天満宮",
    lat: 35.0053,
    lng: 135.7672,
    category: "history",
    city: "京都市中京区",
    address: "中之町537",
    posts: 2,
    hours: "lunch",
    stay: "quick",
    comments: ["錦市場の東端にあるので食べ歩きの締めに寄れます"],
  },
  {
    name: "キモノフォレスト",
    lat: 35.0154,
    lng: 135.6779,
    category: "photogenic",
    city: "京都市右京区",
    address: "嵯峨天龍寺造路町",
    posts: 3,
    hours: "evening",
    stay: "quick",
    comments: ["嵐電嵐山駅のホームにあり、日没後にポールが光ります"],
  },
];

/** 固定シードの疑似乱数（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/** 決定的な UUID（version 4 / variant 8 の形式を満たす） */
export function seedUuid(kind: "spot" | "post" | "image", n: number): string {
  const prefix = kind === "spot" ? "b0000000" : kind === "post" ? "c0000000" : "d0000000";
  return `${prefix}-0000-4000-8000-${hex(n, 12)}`;
}

/** 2026-04-01 から dayOffset 日後の日付文字列 */
function seedDate(dayOffset: number): string {
  const d = new Date(Date.UTC(2026, 3, 1) + dayOffset * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 2026-04-01〜2026-10-09 の範囲で投稿日時を作る（日本時間） */
function seedCreatedAt(rng: () => number, hours: HourProfile): string {
  const day = Math.floor(rng() * 192);
  const hour = pick(rng, HOUR_PROFILES[hours]);
  const minute = Math.floor(rng() * 60);
  const second = Math.floor(rng() * 60);
  return `${seedDate(day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000+09:00`;
}

/** 初期データを生成する（決定的） */
export function buildSeedData(): SeedData {
  const rng = mulberry32(20261010);
  const profiles = SEED_PROFILES.map((p) => ({ ...p }));
  const spots: Spot[] = [];
  const posts: Post[] = [];
  const images: StoredImage[] = [];
  const likes: LikeRow[] = [];
  const userIds = [
    SEED_USER_IDS.userA,
    SEED_USER_IDS.userA,
    SEED_USER_IDS.userB,
    SEED_USER_IDS.userB,
    SEED_USER_IDS.admin,
  ];

  let postSeq = 1;
  let imageSeq = 1;

  SPOT_SEEDS.forEach((seed, spotIndex) => {
    const spotId = seedUuid("spot", spotIndex + 1);
    const comments = [...seed.comments, ...GENERIC_COMMENTS[seed.category]];
    const spotPosts: Post[] = [];
    const imagesByPost = new Map<string, StoredImage[]>();
    let imageNo = 1;

    for (let i = 0; i < seed.posts; i += 1) {
      const postId = seedUuid("post", postSeq);
      postSeq += 1;
      const userId = pick(rng, userIds);
      const createdAt = seedCreatedAt(rng, seed.hours);
      const category: Category = rng() < 0.08 ? ALT_CATEGORY[seed.category] : seed.category;
      const post: Post = {
        id: postId,
        userId,
        spotId,
        comment: comments[i % comments.length],
        category,
        stayDuration: pick(rng, STAY_PROFILES[seed.stay]),
        likeCount: 0,
        status: "public",
        createdAt,
        updatedAt: createdAt,
      };

      const imageCount = 1 + (rng() < 0.35 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
      const postImages: StoredImage[] = [];
      for (let k = 0; k < imageCount; k += 1) {
        postImages.push({
          id: seedUuid("image", imageSeq),
          postId,
          fullPath: `seed/${spotId}/${imageNo}.svg`,
          thumbPath: `seed/${spotId}/${imageNo}_t.svg`,
          width: 1600,
          height: 1200,
          sortOrder: k,
        });
        imageSeq += 1;
        imageNo += 1;
      }
      images.push(...postImages);
      imagesByPost.set(postId, postImages);

      // いいね：投稿者以外のユーザーが一定確率で付ける。人気スポットほど付きやすい
      const likeProb = seed.posts >= 10 ? 0.55 : 0.3;
      for (const liker of SEED_USER_ID_LIST) {
        if (liker === userId) continue;
        if (rng() < likeProb) {
          likes.push({ userId: liker, postId, createdAt });
          post.likeCount += 1;
        }
      }

      spotPosts.push(post);
      posts.push(post);
    }

    const firstPost = [...spotPosts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const base: Spot = {
      id: spotId,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      address: seed.address,
      prefecture: PREFECTURE,
      city: seed.city,
      category: seed.category,
      source: "gps",
      externalRef: null,
      postCount: 0,
      likeCount: 0,
      coverImageId: null,
      stayMinutesMedian: null,
      hourHistogram: new Array<number>(24).fill(0),
      openingHours: null,
      createdBy: firstPost?.userId ?? SEED_USER_IDS.userA,
      createdAt: firstPost?.createdAt ?? SEED_PROFILE_CREATED_AT,
    };
    spots.push(computeSpotStats(base, spotPosts, (postId) => imagesByPost.get(postId) ?? []));
  });

  return { profiles, spots, posts, images, likes };
}

/** seed のスポット名とカテゴリ（/api/dev/files のプレースホルダー画像用。削除後も名前を出せるように） */
export function seedSpotInfo(spotId: string): { name: string; category: Category } | null {
  const m = /^b0000000-0000-4000-8000-([0-9a-f]{12})$/.exec(spotId);
  if (!m) return null;
  const seed = SPOT_SEEDS[parseInt(m[1], 16) - 1];
  return seed ? { name: seed.name, category: seed.category } : null;
}
