import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "利用規約" };

const UPDATED_AT = "2026年10月10日";

/** S-14：利用規約（学生ハッカソン作品向けの簡潔な内容） */
export default function TermsPage() {
  return (
    <>
      <PageHeader title="利用規約" backHref="/" />
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 text-base leading-relaxed text-text">
        <p className="text-text-muted">最終更新日：{UPDATED_AT}</p>
        <p>
          この利用規約（以下「本規約」）は、「旅行どこいこう」（以下「本サービス」）の利用条件を定めるものです。本サービスは学生のハッカソン作品として開発・公開されており、利用者は本規約に同意したうえで本サービスを利用するものとします。
        </p>

        <Section title="1. サービスの内容">
          <p>
            本サービスは、利用者が投稿した写真を地図上に表示し、行きたい場所のリスト作成やおすすめ経路の作成を行うものです。機能は予告なく変更・停止・終了することがあります。
          </p>
        </Section>

        <Section title="2. アカウント">
          <p>
            投稿やリスト作成には Google
            アカウントでのログインが必要です。アカウントの管理は利用者自身の責任で行ってください。利用者はマイページからいつでも退会でき、退会すると投稿・リスト・プランなどのデータは削除されます。
          </p>
        </Section>

        <Section title="3. 投稿について">
          <ul className="list-disc space-y-1 pl-6">
            <li>投稿できるのは、利用者自身が撮影した写真、または投稿する権利を持つ写真に限ります。</li>
            <li>
              他人の顔やナンバープレートなど個人を特定できるもの、私有地の内部、立入禁止区域の写真は投稿しないでください。
            </li>
            <li>投稿された写真・コメントは、本サービス内で他の利用者に公開されます。</li>
            <li>利用者は自分の投稿をいつでも編集・削除できます。</li>
            <li>
              通報が一定数に達した投稿は自動的に非表示になります。運営者は不適切と判断した投稿を予告なく削除できます。
            </li>
          </ul>
        </Section>

        <Section title="4. 禁止事項">
          <ul className="list-disc space-y-1 pl-6">
            <li>法令または公序良俗に反する行為</li>
            <li>他者の権利（著作権、肖像権、プライバシーなど）を侵害する行為</li>
            <li>虚偽の場所情報や無関係な写真の投稿、スパム行為</li>
            <li>本サービスの運営を妨げる行為、不正アクセス、自動化ツールによる大量アクセス</li>
          </ul>
        </Section>

        <Section title="5. 外部サービスと地図データ">
          <p>
            本サービスは地図タイル、経路計算、場所検索に外部の無料サービスを利用しています。無料枠の上限に達した場合、一部の機能（投稿、経路作成、外部検索）を一時的に停止することがあります。経路の所要時間はあくまで目安であり、実際の交通状況や営業時間を保証するものではありません。
          </p>
        </Section>

        <Section title="6. 免責">
          <p>
            本サービスは現状有姿で提供され、内容の正確性、完全性、継続性を保証しません。本サービスの利用、または利用できないことによって生じた損害について、開発者は責任を負いません。旅行先の安全、営業時間、料金などは必ずご自身で確認してください。
          </p>
        </Section>

        <Section title="7. 規約の変更">
          <p>
            本規約は必要に応じて変更することがあります。変更後の規約は本ページに掲載した時点で効力を持ちます。
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
