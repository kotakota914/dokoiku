import Link from "next/link";

/** S-11：利用規約・プライバシーポリシーへの同意文 */
export function AgreementNotice() {
  return (
    <p className="text-base text-text-muted">
      ログインすると、
      <Link href="/terms" className="text-primary-strong underline underline-offset-2">
        利用規約
      </Link>
      と
      <Link href="/privacy" className="text-primary-strong underline underline-offset-2">
        プライバシーポリシー
      </Link>
      に同意したものとみなします。
    </p>
  );
}
