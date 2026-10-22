#!/usr/bin/env bash
# =============================================================================
# migration と seed をローカル PostgreSQL（PostGIS 付き）で検証する（npm run db:validate）
#
# 1. 使い捨て DB dokoiko_validate を作り直す
# 2. Supabase の auth / storage スキーマと役割のスタブを入れる（scripts/db/local-stubs.sql）
# 3. supabase/migrations/*.sql（ファイル名順。0001_init -> 0002_storage -> 0003_v03 ...）-> supabase/seed.sql を順に流す
# 4. scripts/db/smoke.sql のスモークテスト（bbox 検索、近傍検索、統計、RLS）を流す
#
# 接続先：
#   - DATABASE_URL があればそれを使う（例: postgres://postgres:pass@localhost:5432/postgres）
#   - なければ postgres ユーザーで psql（現在のユーザーで接続できなければ su postgres）
# 環境変数 SKIP_STORAGE=1 で 0002_storage.sql を省略できる。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_NAME="${VALIDATE_DB_NAME:-dokoiko_validate}"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
SEED_FILE="$ROOT/supabase/seed.sql"
STUBS_FILE="$ROOT/scripts/db/local-stubs.sql"
SMOKE_FILE="$ROOT/scripts/db/smoke.sql"

PSQL_MODE=""
ADMIN_URL=""
TARGET_URL=""

# psql の実行方法を決める
detect_psql() {
  if [ -n "${DATABASE_URL:-}" ]; then
    PSQL_MODE="url"
    ADMIN_URL="$DATABASE_URL"
    # パス部分（DB 名）を検証用 DB に置き換える
    TARGET_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#(postgres(ql)?://[^/]+)/[^?]*#\1/${DB_NAME}#")"
    if [ "$TARGET_URL" = "$DATABASE_URL" ]; then
      TARGET_URL="${DATABASE_URL%/}/${DB_NAME}"
    fi
    return
  fi
  if psql -X -d postgres -c 'select 1' >/dev/null 2>&1; then
    PSQL_MODE="local"
    return
  fi
  if command -v su >/dev/null 2>&1 && su postgres -c "psql -X -d postgres -c 'select 1'" >/dev/null 2>&1; then
    PSQL_MODE="su"
    return
  fi
  echo "error: PostgreSQL に接続できません。DATABASE_URL を設定するか、postgres ユーザーで psql を実行できるようにしてください" >&2
  exit 1
}

# 管理用 DB（postgres）に対して SQL を 1 文実行する
run_admin() {
  local sql="$1"
  case "$PSQL_MODE" in
    url) psql -X -v ON_ERROR_STOP=1 -q "$ADMIN_URL" -c "$sql" ;;
    local) psql -X -v ON_ERROR_STOP=1 -q -d postgres -c "$sql" ;;
    su) su postgres -c "psql -X -v ON_ERROR_STOP=1 -q -d postgres -c \"$sql\"" ;;
  esac
}

# 検証用 DB に対して SQL ファイルを流す（標準入力で渡すので postgres ユーザーの読み取り権限は不要）
run_file() {
  local file="$1"
  echo "==> $(basename "$file")"
  case "$PSQL_MODE" in
    url) psql -X -v ON_ERROR_STOP=1 -q "$TARGET_URL" <"$file" ;;
    local) psql -X -v ON_ERROR_STOP=1 -q -d "$DB_NAME" <"$file" ;;
    su) su postgres -c "psql -X -v ON_ERROR_STOP=1 -q -d $DB_NAME" <"$file" ;;
  esac
}

detect_psql
echo "接続方法: $PSQL_MODE / 検証用 DB: $DB_NAME"

# 使い捨て DB を作り直す
run_admin "drop database if exists ${DB_NAME} with (force)"
run_admin "create database ${DB_NAME}"

# スタブ -> migration（ファイル名順）-> seed -> スモークテスト
run_file "$STUBS_FILE"
for migration in "$MIGRATIONS_DIR"/*.sql; do
  if [ "${SKIP_STORAGE:-0}" = "1" ] && [ "$(basename "$migration")" = "0002_storage.sql" ]; then
    echo "==> 0002_storage.sql（SKIP_STORAGE=1 のため省略）"
    continue
  fi
  run_file "$migration"
done
run_file "$SEED_FILE"
run_file "$SMOKE_FILE"

echo "db:validate OK（migration・seed・スモークテストがすべて通りました）"
