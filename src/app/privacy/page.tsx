import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "プライバシーポリシー" };

const UPDATED_AT = "2026年10月10日";

/** S-14：プライバシーポリシー */
export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="プライバシーポリシー" backHref="/" />
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 text-base leading-relaxed text-text">
        <p className="text-text-muted">最終更新日：{UPDATED_AT}</p>
        <p>
          「旅行どこいこう」（以下「本サービス」）は、学生のハッカソン作品として開発されています。本サービスが取り扱う個人情報と、その利用方法について説明します。
        </p>

        <Section title="1. 取得する情報">
          <p>本サービスが保存する個人情報は、Google ログイン時に取得する次の項目のみです。</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>メールアドレス（ログインの識別に使用。画面には表示しません）</li>
            <li>
              表示名（初回ログイン時に Google アカウントの名前を初期値として設定し、利用者が変更できます）
            </li>
            <li>プロフィール画像の URL</li>
          </ul>
          <p>
            上記に加えて、利用者が投稿した写真・コメント・カテゴリ・滞在時間、作成したリストとプランを保存します。
          </p>
        </Section>

        <Section title="2. 位置情報について">
          <ul className="list-disc space-y-1 pl-6">
            <li>
              利用者の現在地は、地図の初期表示と近くのスポット検索のためにブラウザ上で一時的に利用するだけで、サーバーには保存しません。
            </li>
            <li>
              投稿時に保存される緯度・経度は、利用者が選んだスポットの位置であり、利用者自身の位置履歴ではありません。
            </li>
            <li>
              写真は投稿前にブラウザで変換し、撮影日時・位置情報などの EXIF
              情報をすべて除去してからアップロードします。
            </li>
          </ul>
        </Section>

        <Section title="3. 利用目的">
          <ul className="list-disc space-y-1 pl-6">
            <li>ログインと本人確認</li>
            <li>投稿者の表示名とアイコンの表示</li>
            <li>投稿・リスト・プランの保存と表示</li>
            <li>不正利用や通報への対応</li>
          </ul>
        </Section>

        <Section title="4. 第三者への提供と外部サービス">
          <p>
            取得した個人情報を第三者に販売・提供することはありません。本サービスは、認証とデータ保存に
            Supabase、地図表示に OpenFreeMap、経路計算に OpenRouteService、場所検索に
            Nominatim（OpenStreetMap）を利用しています。経路計算と場所検索では、スポットの座標や検索語がこれらのサービスに送信されますが、利用者の個人情報は送信しません。
          </p>
        </Section>

        <Section title="5. 投稿の削除と退会">
          <p>
            利用者は自分の投稿をいつでも削除できます。削除した写真はストレージからも削除されます。マイページから退会すると、アカウント情報、投稿、リスト、プランなど本サービスが保存しているすべてのデータを削除します。
          </p>
        </Section>

        <Section title="6. 安全管理">
          <p>
            データの保存先はアクセス制御（Row Level Security）を設定したデータベースを使用し、API
            キーなどの秘密情報はサーバー側でのみ扱います。ログにメールアドレスや現在地を出力しません。
          </p>
        </Section>

        <Section title="7. 免責とポリシーの変更">
          <p>
            本サービスは学習目的の作品であり、商用サービスと同等の安全性・継続性を保証するものではありません。本ポリシーは必要に応じて変更することがあり、変更後は本ページに掲載した時点で効力を持ちます。
          </p>
        </Section>
      </article>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
