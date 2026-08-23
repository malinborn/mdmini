#!/usr/bin/env bash
# Testcase for the md-mini AI interface: show -> edit -> ask -> ask --multi --free-text.
# Walks through every AI verb with pauses, so each step can be screenshotted.
#
#   ./demo/ai-demo.sh              # drive the dev build (src-tauri/target/debug/md-mini)
#   ./demo/ai-demo.sh --release    # drive the installed release app via the mdmini wrapper
#
# Overrides: MDMINI_BIN, MDMINI_SOCK.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC="$HERE/ai-demo.md"

MODE=dev
[[ "${1:-}" == "--release" ]] && MODE=release

if [[ "$MODE" == release ]]; then
  BIN="${MDMINI_BIN:-mdmini}"
  SOCK=""
else
  SOCK="${MDMINI_SOCK:-/tmp/md_mini_dev_cmd.sock}"
  # cargo may build into the worktree or into a shared target dir (.cargo/config.toml).
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
    echo "no dev binary found — run 'npm run dev:app' first, or pass --release / MDMINI_BIN=" >&2
    exit 2
  fi
fi

# One entry point for every verb, so dev/release only differs here.
ai() {
  if [[ "$MODE" == release ]]; then
    "$BIN" "$@"
  else
    "$BIN" ai "$@" --socket "$SOCK"
  fi
}

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
pause() { read -r -p "   Enter — дальше… " _; }

# ---------------------------------------------------------------- 0. чистый файл

# Rewritten on every run, so the testcase is repeatable.
cat > "$DOC" <<'BEFORE'
# Релиз md-mini 1.0 — чек-лист

Песочница для AI-интерфейса. Агент наводится на нужное место, правит
живой буфер и задаёт вопросы прямо в документе — без чата и без
перезаписи файла на диске.

## Что входит в релиз

| Фича                           | Статус | Кто    |
|--------------------------------|--------|--------|
| AI-интерфейс: show / edit / ask | готово | agent  |
| MCP-сервер `mdmini mcp`         | готово | agent  |
| Онбординг при обновлении        | готово | agent  |
| Aurora-темы                     | готово | design |

## Открытые вопросы

- [ ] Публиковать ли live-render как beta
- [ ] Текст анонса на md-mini.com
- [ ] Кому раздать сборку на обкатку

## Заметки

_Пока пусто — сюда агент допишет результат прогона._
BEFORE

step "1/4 · show — открываем файл и наводимся на раздел (пульс ~1.6 с)"
ai show "$DOC" --find "## Открытые вопросы"
echo "   ↑ окно открылось, раздел в центре, строка пульсирует"
pause

step "2/4 · edit — правка живого буфера, подсветка изменённого span"
# edit always takes the COMPLETE new document on stdin; md-mini diffs it itself.
python3 - "$DOC" <<'PY' | ai edit "$DOC" --show
import pathlib, sys
doc = pathlib.Path(sys.argv[1]).read_text()
sys.stdout.write(doc.replace(
    "_Пока пусто — сюда агент допишет результат прогона._",
    "Прогон 1.0-rc: `show` навёл на нужный раздел, `edit` заменил только\n"
    "этот абзац — остальной документ не тронут, курсор и скролл на месте.\n"
    "Подсветка держится до Esc или до следующей правки.",
))
PY
echo "   ↑ changed_lines выше — это тот самый span, он подсвечен в окне"
pause

step "3/4 · ask — вопрос с кнопками прямо в документе (блокирует до клика)"
ai ask "$DOC" \
  --question "Публикуем live-render как beta в 1.0?" \
  --option "Да, в релиз" \
  --option "Нет, отложить" \
  --option "Только под флагом" \
  --at-find "- [ ] Публиковать ли live-render как beta" \
  --timeout 600
echo "   ↑ ответ вернулся в stdout как JSON — плюс подсветка edit всё ещё на месте"
pause

step "4/4 · ask --multi --free-text — чекбоксы + своё поле ввода"
ai ask "$DOC" \
  --question "Кому раздать сборку на обкатку?" \
  --option "AppSec" \
  --option "DevOps" \
  --option "SysAdmins" \
  --option "Вся команда" \
  --multi --free-text \
  --at-find "- [ ] Кому раздать сборку на обкатку" \
  --timeout 600

printf '\n\033[1mГотово.\033[0m Файл: %s\n' "$DOC"
echo "Esc в окне — снять подсветку edit. Cmd+Z — откатить правку агента."
