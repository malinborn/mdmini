#!/usr/bin/env bash
# One continuous run of the md-mini AI interface, paced for a screen recording:
# show -> edit -> three questions (single / multi / free-text) -> edit with the answers.
# No interactive pauses; the only waiting is for the user to answer the questions.
#
#   ./demo/ai-gif-run.sh              # dev build (npm run dev:app must be running)
#   ./demo/ai-gif-run.sh --release    # installed app, via the mdmini wrapper
#
# Overrides: MDMINI_BIN, MDMINI_SOCK, BEAT (pacing multiplier, default 1).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC="$HERE/ai-review.md"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
BEAT="${BEAT:-1}"

MODE=dev
[[ "${1:-}" == "--release" ]] && MODE=release

if [[ "$MODE" == release ]]; then
  BIN="${MDMINI_BIN:-mdmini}"
  SOCK=""
else
  SOCK="${MDMINI_SOCK:-/tmp/md_mini_dev_cmd.sock}"
  BIN="${MDMINI_BIN:-}"
  if [[ -z "$BIN" ]]; then
    for candidate in \
      "$HERE/../src-tauri/target/debug/md-mini" \
      "${CARGO_TARGET_DIR:-}/debug/md-mini" \
      "$HOME/.cargo/shared-target/debug/md-mini"
    do
      [[ -x "$candidate" ]] && BIN="$candidate" && break
    done
  fi
  if [[ -z "$BIN" || ! -x "$BIN" ]]; then
    echo "no dev binary found — run 'npm run dev:app' first, or pass --release" >&2
    exit 2
  fi
fi

ai() {
  if [[ "$MODE" == release ]]; then
    "$BIN" "$@"
  else
    "$BIN" ai "$@" --socket "$SOCK"
  fi
}

beat() { sleep "$(awk -v s="$1" -v m="$BEAT" 'BEGIN{print s*m}')"; }
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ------------------------------------------------------------------ 0. чистая сцена
cat > "$DOC" <<'EOF'
# Ревью релиза 1.0

## Решения

- [ ] Скоуп релиза
- [ ] Ревьюеры
- [ ] Заголовок анонса

## Вывод агента

_Пусто — агент допишет сюда сам._
EOF
beat 1.2

# ------------------------------------------------------------------ 1. show
say "show — навожу на раздел"
ai show "$DOC" --find "## Решения"
beat 2.2

# ------------------------------------------------------------------ 2. edit
say "edit — пишу вывод в живой буфер"
# Keep every version in $OUT: the next edit builds on it, not on the file on disk,
# which may still be catching up through autosave.
python3 - "$DOC" > "$OUT/v2" <<'PY'
import pathlib, sys
doc = pathlib.Path(sys.argv[1]).read_text()
sys.stdout.write(doc.replace(
    "_Пусто — агент допишет сюда сам._",
    "Прочитал 34 коммита ветки: AI-интерфейс (show / edit / ask), MCP-сервер,\n"
    "онбординг и пять тем. Блокеров не нашёл, тесты зелёные. Три решения ниже\n"
    "за тобой — вопросы уже висят в документе.",
))
PY
ai edit "$DOC" --show < "$OUT/v2"
beat 2

# ------------------------------------------------------------- 3-5. три вопроса
# Fired in parallel: three connections, three widgets on screen at once.
say "ask — один выбор"
ai ask "$DOC" \
  --question "Что кладём в 1.0?" \
  --option "AI + темы" \
  --option "Только AI" \
  --option "Всё, включая live-render" \
  --at-find "- [ ] Скоуп релиза" \
  --timeout 3600 > "$OUT/single" &
P1=$!
beat 1.1

say "ask --multi — несколько"
ai ask "$DOC" \
  --question "Кого зовём в ревью?" \
  --option "AppSec" --option "DevOps" --option "SysAdmins" --option "Design" \
  --multi \
  --at-find "- [ ] Ревьюеры" \
  --timeout 3600 > "$OUT/multi" &
P2=$!
beat 1.1

say "ask --free-text — свой вариант"
ai ask "$DOC" \
  --question "Как назовём релиз в анонсе?" \
  --option "md-mini 1.0 — AI-native" \
  --option "Редактор, которым правит агент" \
  --free-text \
  --at-find "- [ ] Заголовок анонса" \
  --timeout 3600 > "$OUT/free" &
P3=$!

say "жду ответы в документе…"
wait $P1 || true
wait $P2 || true
wait $P3 || true
cat "$OUT/single" "$OUT/multi" "$OUT/free"
beat 1.2

# ------------------------------------------------- 6. edit с ответами обратно в док
say "edit — вписываю ответы в документ"
python3 - "$OUT/v2" "$OUT/single" "$OUT/multi" "$OUT/free" > "$OUT/v3" <<'PY'
import json, pathlib, sys

doc_path, *answer_paths = sys.argv[1:]

def read(path):
    try:
        return json.loads(pathlib.Path(path).read_text().strip() or "{}")
    except json.JSONDecodeError:
        return {}

single, multi, free = (read(p) for p in answer_paths)

def one(payload, fallback="—"):
    if payload.get("custom"):
        return payload["custom"]
    if payload.get("answer"):
        return payload["answer"]
    picked = payload.get("answers") or []
    return ", ".join(picked) if picked else fallback

lines = [
    "",
    "## Принятые решения",
    "",
    f"- Скоуп: {one(single)}",
    f"- Ревью: {one(multi, 'никого')}",
    f"- Анонс: {one(free)}",
]
doc = pathlib.Path(doc_path).read_text().rstrip("\n")
sys.stdout.write(doc + "\n" + "\n".join(lines) + "\n")
PY
ai edit "$DOC" --show < "$OUT/v3"

printf '\n\033[1mГотово.\033[0m Esc — снять подсветку, Cmd+Z — откатить правку агента.\n'
