# AI-комментарии в документе — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Комментарии к тексту как в Google Docs, где отвечает AI-агент: человек выделяет фрагмент и пишет коммент, тред живёт в `.mdmini_comments_<doc>.md` рядом с документом, а агент просыпается на новый коммент через Claude Code Monitor и отвечает в живой сессии.

**Architecture:** Источник истины — markdown-файл рядом с документом, не md-mini. Rust-модуль `comments.rs` умеет его читать и точечно править (append/replace, никогда полный re-render — файл правят и люди). Три новые вербы `question`/`answer`/`watch` — локальные и офлайновые, как существующие `help`/`agent`: они не ходят в командный сокет и работают при закрытом приложении. Доставка событий — `mdmini watch`, обычный рекурсивный файловый watcher, чей stdout скармливается Monitor'у. Фронтенд рисует тред блок-виджетом, зеркалящим `ai-ask.ts`.

**Tech Stack:** Rust (Tauri 2, `notify` 8.2 — уже в зависимостях), TypeScript, Svelte 5 runes, CodeMirror 6, vitest, `cargo test`.

**Спека:** `docs/superpowers/specs/2026-08-23-document-requests-design.md`

**Никаких новых зависимостей.** Генерация id — `DefaultHasher` из std. Форматирование времени — собственная функция на std (задача 1). `notify` уже есть.

---

## Формат файла — контракт, на который опираются все задачи

```markdown
<!-- mdmini:comments v=1 doc=CLAUDE.md -->

<!-- mdmini:c id=c-7f3a2c status=open line=42 -->
> We ship via Caddy on the host

**Макс** · 2026-08-24 14:02
Почему не nginx? Разверни абзац.

**agent (worktree-foo)** · 2026-08-24 14:05
Nginx на этом хосте был сломан, поэтому…
```

Правила, обязательные для всех задач:

- Маркер треда — строка, начинающаяся с `<!-- mdmini:c `. Атрибуты `k=v`, разделены пробелами, значения без пробелов.
- Цитата якоря — идущие сразу за маркером строки, начинающиеся с `> `.
- Заголовок реплики — строка вида `**<author>** · <at>`. Автор не содержит `*`. Текст реплики — всё до следующего заголовка реплики или следующего маркера треда.
- Неизвестные атрибуты игнорируются, битый маркер пропускается — файл никогда не теряется целиком.
- md-mini **никогда не перезаписывает файл целиком**: только append блока, append реплики внутрь треда и замена одной строки-маркера. Полный `render` существует только для создания нового файла и для тестов.

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `src-tauri/src/comments.rs` (создать) | Типы `Thread`/`Reply`/`Status`, путь сайдкара, генерация id, форматирование времени, парсер, точечные мутации, атомарная запись |
| `src-tauri/src/watch.rs` (создать) | `mdmini watch`: рекурсивный watcher, дедупликация уже отданных id, формат строки события |
| `src-tauri/src/ai_socket.rs` (менять) | Три верба в `CliVerb`, `parse_cli_args`, ранняя ветка `run_ai_cli`, `USAGE`, текст сниппетов |
| `src-tauri/src/mcp_server.rs` (менять) | Тулы `question`/`answer`, вызывающие `comments` напрямую |
| `src-tauri/src/lib.rs` (менять) | Регистрация модулей и Tauri-команд |
| `src-tauri/src/watcher.rs` (менять) | Добавить сайдкар документа в набор наблюдаемых файлов |
| `scripts/mdmini` (менять) | Три верба в офлайновую ветку |
| `src/lib/comment-format.ts` (создать) | Чистые функции: парсинг, поиск цитаты для привязки, текст промпта для буфера |
| `src/lib/editor/ai-comment.ts` (создать) | StateEffects, StateField, блок-виджет треда |
| `src/lib/editor/setup.ts` (менять) | Подключить `aiCommentField` |
| `src/styles/editor.css` (менять) | `.cm-ai-comment-*` поверх токенов `--ai-ask-*` |
| `src/App.svelte` (менять) | Загрузка тредов, реакция на внешнее изменение сайдкара, действия треда |
| `src-tauri/src/menu.rs` (менять) | Пункт «Прокомментировать выделенное» в меню AI |
| `docs/ai-interface.md` (менять) | Документация трёх верб, Monitor, Stop-хук |

---

## Task 1: comments.rs — типы, путь сайдкара, id, время

**Files:**
- Create: `src-tauri/src/comments.rs`
- Modify: `src-tauri/src/lib.rs:1-11` (добавить `pub mod comments;`)

- [ ] **Step 1: Написать падающие тесты**

Создать `src-tauri/src/comments.rs` только с тестами внизу — конвенция репозитория — и пустыми объявлениями:

```rust
//! Слой комментариев: чтение и точечная правка `.mdmini_comments_<doc>.md`.
//!
//! Источник истины — файл, а не md-mini. Поэтому здесь нет ни стора, ни GC:
//! модуль умеет только разобрать файл и внести в него минимальное изменение.
//! Полной перезаписи нет сознательно — файл правят и агенты, и люди руками.

use std::path::{Path, PathBuf};

/// Статус треда.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Open,
    Answered,
    Resolved,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Open => "open",
            Status::Answered => "answered",
            Status::Resolved => "resolved",
        }
    }

    pub fn parse(s: &str) -> Option<Status> {
        match s {
            "open" => Some(Status::Open),
            "answered" => Some(Status::Answered),
            "resolved" => Some(Status::Resolved),
            _ => None,
        }
    }
}

/// Путь файла комментариев для документа: тот же каталог, имя с префиксом.
pub fn sidecar_path(doc: &Path) -> Option<PathBuf> {
    let name = doc.file_name()?.to_str()?;
    Some(doc.with_file_name(format!(".mdmini_comments_{}", name)))
}

/// `true`, если путь сам является файлом комментариев. Такие файлы нельзя
/// комментировать и нельзя считать документами — иначе получится рекурсия.
pub fn is_sidecar(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with(".mdmini_comments_"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_sits_next_to_the_document() {
        let p = sidecar_path(Path::new("/repo/docs/CLAUDE.md")).unwrap();
        assert_eq!(p, PathBuf::from("/repo/docs/.mdmini_comments_CLAUDE.md"));
    }

    #[test]
    fn sidecar_is_recognised_and_a_document_is_not() {
        assert!(is_sidecar(Path::new("/repo/.mdmini_comments_spec.md")));
        assert!(!is_sidecar(Path::new("/repo/spec.md")));
    }

    #[test]
    fn status_round_trips_through_its_string() {
        for s in [Status::Open, Status::Answered, Status::Resolved] {
            assert_eq!(Status::parse(s.as_str()), Some(s));
        }
        assert_eq!(Status::parse("nonsense"), None);
    }
}
```

Добавить в `src-tauri/src/lib.rs` первой строкой модулей:

```rust
pub mod comments;
```

- [ ] **Step 2: Прогнать тесты**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: три теста проходят (реализация уже написана в шаге 1 — это база, а не TDD-цикл; настоящий TDD начинается со шага 3).

- [ ] **Step 3: Написать падающий тест на форматирование времени**

Добавить в `mod tests`:

```rust
    #[test]
    fn epoch_formats_as_utc_datetime() {
        // 2026-08-24T14:02:03Z
        assert_eq!(fmt_utc(1787580123), "2026-08-24 14:02:03");
        // Полночь эпохи — граничный случай алгоритма.
        assert_eq!(fmt_utc(0), "1970-01-01 00:00:00");
        // Последняя секунда до високосного дня.
        assert_eq!(fmt_utc(1709164799), "2024-02-28 23:59:59");
        assert_eq!(fmt_utc(1709164800), "2024-02-29 00:00:00");
    }
```

- [ ] **Step 4: Прогнать — тест не компилируется**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: FAIL, `cannot find function fmt_utc`.

- [ ] **Step 5: Реализовать fmt_utc**

Добавить в `comments.rs` (алгоритм civil-from-days Говарда Хиннанта — без внешних крейтов):

```rust
/// Отформатировать epoch-секунды как `YYYY-MM-DD HH:MM:SS` в UTC.
///
/// Своя реализация вместо крейта дат: в проекте нет ни `chrono`, ни `time`, а
/// нужна ровно одна функция. Алгоритм — civil-from-days: сдвигаем эпоху на
/// 1 марта 0000, чтобы високосный день оказался последним днём года и выпал
/// из арифметики месяцев.
pub fn fmt_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        y,
        m,
        d,
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60
    )
}

/// Текущее время как epoch-секунды. Отдельная функция, чтобы тесты формата
/// работали с фиксированными значениями, а не с часами.
pub fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
```

- [ ] **Step 6: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: PASS, четыре теста.

- [ ] **Step 7: Написать падающий тест на генерацию id**

```rust
    #[test]
    fn ids_look_right_and_differ_by_seed() {
        let a = new_id(Path::new("/repo/spec.md"), 1);
        let b = new_id(Path::new("/repo/spec.md"), 2);
        assert!(a.starts_with("c-"), "got {a}");
        assert_eq!(a.len(), 8, "c- plus six hex chars");
        assert!(a.chars().skip(2).all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "разные seed дают разные id");
    }

    #[test]
    fn id_is_unique_against_existing_threads() {
        let taken = ["c-000000".to_string()];
        // Подобранный seed, чей первый хеш совпал бы с занятым id, должен
        // привести к другому результату, а не к коллизии.
        let id = new_id_avoiding(Path::new("/repo/spec.md"), 1, &taken);
        assert!(!taken.contains(&id));
    }
```

- [ ] **Step 8: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: FAIL, `cannot find function new_id`.

- [ ] **Step 9: Реализовать генерацию id**

```rust
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Короткий id треда: `c-` плюс шесть hex-символов. Не криптографический —
/// нужен лишь стабильный человекочитаемый ключ внутри одного файла, поэтому
/// `DefaultHasher` из std вместо новой зависимости.
pub fn new_id(doc: &Path, seed: u64) -> String {
    let mut hasher = DefaultHasher::new();
    doc.hash(&mut hasher);
    seed.hash(&mut hasher);
    format!("c-{:06x}", hasher.finish() & 0xff_ffff)
}

/// То же, но гарантированно не совпадает ни с одним занятым id: при коллизии
/// подмешивает счётчик. Коллизия на шести hex-символах маловероятна, но файл
/// живёт долго и правится руками — дешевле проверить, чем ловить дубль.
pub fn new_id_avoiding(doc: &Path, seed: u64, taken: &[String]) -> String {
    for bump in 0..1_000 {
        let candidate = new_id(doc, seed.wrapping_add(bump));
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    // Практически недостижимо; лучше вернуть заведомо валидный id, чем паниковать.
    new_id(doc, seed ^ now_epoch())
}
```

- [ ] **Step 10: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: PASS, шесть тестов.

- [ ] **Step 11: Clippy и коммит**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/comments.rs src-tauri/src/lib.rs
git commit -m "feat(comments): sidecar path, thread status, UTC formatting and id generation"
```

---

## Task 2: comments.rs — парсер файла

**Files:**
- Modify: `src-tauri/src/comments.rs`

- [ ] **Step 1: Написать падающий тест**

```rust
    const SAMPLE: &str = "\
<!-- mdmini:comments v=1 doc=CLAUDE.md -->

<!-- mdmini:c id=c-7f3a2c status=open line=42 -->
> We ship via Caddy on the host

**Макс** · 2026-08-24 14:02
Почему не nginx? Разверни абзац.

**agent (worktree-foo)** · 2026-08-24 14:05
Nginx там был сломан.
Вторая строка ответа.

<!-- mdmini:c id=c-abc123 status=resolved line=7 -->
> заголовок

**Макс** · 2026-08-24 09:00
Мелочь.
";

    #[test]
    fn parses_threads_replies_and_quotes() {
        let threads = parse(SAMPLE);
        assert_eq!(threads.len(), 2);

        let first = &threads[0];
        assert_eq!(first.id, "c-7f3a2c");
        assert_eq!(first.status, Status::Open);
        assert_eq!(first.line, 42);
        assert_eq!(first.quote, "We ship via Caddy on the host");
        assert_eq!(first.replies.len(), 2);
        assert_eq!(first.replies[0].author, "Макс");
        assert_eq!(first.replies[0].at, "2026-08-24 14:02");
        assert_eq!(first.replies[0].text, "Почему не nginx? Разверни абзац.");
        assert_eq!(first.replies[1].author, "agent (worktree-foo)");
        assert_eq!(
            first.replies[1].text,
            "Nginx там был сломан.\nВторая строка ответа."
        );

        assert_eq!(threads[1].id, "c-abc123");
        assert_eq!(threads[1].status, Status::Resolved);
    }

    #[test]
    fn a_broken_marker_is_skipped_without_losing_the_rest() {
        let text = "\
<!-- mdmini:c status=open line=1 -->
> нет id

**Макс** · 14:00
Пропасть.

<!-- mdmini:c id=c-ok0001 status=open line=2 -->
> есть id

**Макс** · 14:01
Остаться.
";
        let threads = parse(text);
        assert_eq!(threads.len(), 1, "тред без id отброшен");
        assert_eq!(threads[0].id, "c-ok0001");
    }

    #[test]
    fn unknown_attributes_are_ignored() {
        let text = "<!-- mdmini:c id=c-111111 status=open line=3 future=yes -->\n> q\n\n**Макс** · 14:00\nt\n";
        let threads = parse(text);
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].line, 3);
    }

    #[test]
    fn multiline_quote_is_joined_with_newlines() {
        let text = "<!-- mdmini:c id=c-222222 status=open line=1 -->\n> первая\n> вторая\n\n**Макс** · 14:00\nt\n";
        assert_eq!(parse(text)[0].quote, "первая\nвторая");
    }
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: FAIL, `cannot find function parse` / `cannot find type Thread`.

- [ ] **Step 3: Реализовать типы и парсер**

```rust
/// Одна реплика внутри треда.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Reply {
    pub author: String,
    pub at: String,
    pub text: String,
}

/// Один тред, привязанный к фрагменту документа.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Thread {
    pub id: String,
    pub status: Status,
    /// Номер строки на момент последней записи — подсказка и fallback.
    /// Привязка идёт поиском `quote`, а не по этому числу.
    pub line: usize,
    pub quote: String,
    pub replies: Vec<Reply>,
}

const THREAD_MARKER: &str = "<!-- mdmini:c ";

/// Разобрать атрибуты `k=v` из строки-маркера треда.
fn parse_marker(line: &str) -> Option<(String, Status, usize)> {
    let inner = line.trim().strip_prefix(THREAD_MARKER)?.strip_suffix("-->")?;
    let mut id = None;
    let mut status = None;
    let mut num = None;
    for pair in inner.split_whitespace() {
        let (key, value) = pair.split_once('=')?;
        match key {
            "id" => id = Some(value.to_string()),
            "status" => status = Status::parse(value),
            "line" => num = value.parse::<usize>().ok(),
            _ => {} // неизвестные атрибуты игнорируются намеренно
        }
    }
    Some((id?, status?, num.unwrap_or(1)))
}

/// Разобрать заголовок реплики `**author** · at`.
fn parse_reply_header(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("**")?;
    let (author, tail) = rest.split_once("**")?;
    if author.contains('*') {
        return None;
    }
    let at = tail.trim().strip_prefix('·')?.trim();
    Some((author.to_string(), at.to_string()))
}

/// Разобрать весь файл комментариев. Битые треды пропускаются, остальные
/// возвращаются — файл никогда не теряется целиком из-за одной опечатки.
pub fn parse(text: &str) -> Vec<Thread> {
    let mut threads: Vec<Thread> = Vec::new();
    let mut current: Option<Thread> = None;
    let mut skipping = false;
    let mut reply: Option<Reply> = None;

    for line in text.lines() {
        if line.trim_start().starts_with(THREAD_MARKER) {
            if let (Some(mut thread), Some(r)) = (current.take(), reply.take()) {
                thread.replies.push(r);
                threads.push(thread);
            } else if let Some(thread) = current.take() {
                threads.push(thread);
            }
            reply = None;
            match parse_marker(line) {
                Some((id, status, num)) => {
                    skipping = false;
                    current = Some(Thread {
                        id,
                        status,
                        line: num,
                        quote: String::new(),
                        replies: Vec::new(),
                    });
                }
                None => {
                    skipping = true;
                }
            }
            continue;
        }

        if skipping {
            continue;
        }
        let Some(thread) = current.as_mut() else {
            continue; // преамбула файла до первого треда
        };

        if reply.is_none() {
            if let Some(quoted) = line.strip_prefix("> ") {
                if !thread.quote.is_empty() {
                    thread.quote.push('\n');
                }
                thread.quote.push_str(quoted.trim_end());
                continue;
            }
        }

        if let Some((author, at)) = parse_reply_header(line) {
            if let Some(previous) = reply.take() {
                thread.replies.push(previous);
            }
            reply = Some(Reply {
                author,
                at,
                text: String::new(),
            });
            continue;
        }

        if let Some(r) = reply.as_mut() {
            if line.trim().is_empty() && r.text.is_empty() {
                continue;
            }
            if !r.text.is_empty() {
                r.text.push('\n');
            }
            r.text.push_str(line);
        }
    }

    if let Some(mut thread) = current.take() {
        if let Some(r) = reply.take() {
            thread.replies.push(r);
        }
        threads.push(thread);
    }

    for thread in &mut threads {
        for r in &mut thread.replies {
            r.text = r.text.trim_end().to_string();
        }
    }
    threads
}
```

- [ ] **Step 4: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: PASS, десять тестов.

- [ ] **Step 5: Clippy и коммит**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/comments.rs
git commit -m "feat(comments): parse the comment file into threads and replies"
```

---

## Task 3: comments.rs — точечные мутации и атомарная запись

**Files:**
- Modify: `src-tauri/src/comments.rs`

- [ ] **Step 1: Написать падающие тесты**

```rust
    fn temp_doc(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdmini-comments-test-{}", new_id(Path::new(name), now_epoch())));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn append_creates_the_file_with_a_header() {
        let doc = temp_doc("spec.md");
        append_thread(&doc, "c-aaaaaa", 12, "цитата", "Макс", "Вопрос?").unwrap();

        let text = std::fs::read_to_string(sidecar_path(&doc).unwrap()).unwrap();
        assert!(text.starts_with("<!-- mdmini:comments v=1 doc=spec.md -->"));
        let threads = parse(&text);
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id, "c-aaaaaa");
        assert_eq!(threads[0].status, Status::Open);
        assert_eq!(threads[0].quote, "цитата");
        assert_eq!(threads[0].replies[0].text, "Вопрос?");
    }

    #[test]
    fn append_reply_lands_in_the_right_thread_and_sets_answered() {
        let doc = temp_doc("spec.md");
        append_thread(&doc, "c-aaaaaa", 1, "q1", "Макс", "Первый?").unwrap();
        append_thread(&doc, "c-bbbbbb", 2, "q2", "Макс", "Второй?").unwrap();

        append_reply(&doc, "c-aaaaaa", "agent", "Ответ на первый.").unwrap();

        let threads = load(&doc).unwrap();
        assert_eq!(threads[0].replies.len(), 2);
        assert_eq!(threads[0].replies[1].author, "agent");
        assert_eq!(threads[0].status, Status::Answered, "ответ переводит в answered");
        assert_eq!(threads[1].replies.len(), 1, "второй тред не тронут");
        assert_eq!(threads[1].status, Status::Open);
    }

    #[test]
    fn set_status_rewrites_only_the_marker() {
        let doc = temp_doc("spec.md");
        append_thread(&doc, "c-aaaaaa", 5, "q", "Макс", "Вопрос?").unwrap();
        let before = std::fs::read_to_string(sidecar_path(&doc).unwrap()).unwrap();

        set_status(&doc, "c-aaaaaa", Status::Resolved).unwrap();

        let after = std::fs::read_to_string(sidecar_path(&doc).unwrap()).unwrap();
        assert_eq!(load(&doc).unwrap()[0].status, Status::Resolved);
        assert_eq!(
            before.lines().count(),
            after.lines().count(),
            "изменилась ровно одна строка, структура файла та же"
        );
        assert!(after.contains("Вопрос?"), "текст реплики цел");
    }

    #[test]
    fn answering_an_unknown_id_is_an_error_and_leaves_the_file_alone() {
        let doc = temp_doc("spec.md");
        append_thread(&doc, "c-aaaaaa", 1, "q", "Макс", "Вопрос?").unwrap();
        let before = std::fs::read_to_string(sidecar_path(&doc).unwrap()).unwrap();

        let err = append_reply(&doc, "c-nope00", "agent", "мимо").unwrap_err();
        assert!(err.contains("c-nope00"), "ошибка называет id: {err}");
        assert_eq!(
            std::fs::read_to_string(sidecar_path(&doc).unwrap()).unwrap(),
            before
        );
    }

    #[test]
    fn a_comment_file_cannot_itself_be_commented() {
        let doc = temp_doc(".mdmini_comments_spec.md");
        let err = append_thread(&doc, "c-aaaaaa", 1, "q", "Макс", "?").unwrap_err();
        assert!(err.contains("comment file"), "got {err}");
    }
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: FAIL, `cannot find function append_thread`.

- [ ] **Step 3: Реализовать мутации**

```rust
/// Атомарная запись: сначала `.tmp`, затем `rename`. Файл правят двое —
/// md-mini и агент, — поэтому частично записанного состояния быть не должно.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("failed to rename into {}: {e}", path.display()))
}

/// Прочитать треды документа. Отсутствующий файл — это пустой список, а не ошибка.
pub fn load(doc: &Path) -> Result<Vec<Thread>, String> {
    let path = sidecar_path(doc).ok_or_else(|| "bad document path".to_string())?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(parse(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("failed to read {}: {e}", path.display())),
    }
}

fn guard_not_sidecar(doc: &Path) -> Result<(), String> {
    if is_sidecar(doc) {
        return Err("refusing to comment on a comment file".to_string());
    }
    Ok(())
}

/// Отрендерить блок одного треда — единственное место, где формат собирается.
fn render_thread(id: &str, status: Status, line: usize, quote: &str, author: &str, at: &str, text: &str) -> String {
    let quoted: String = quote.lines().map(|l| format!("> {l}\n")).collect();
    format!(
        "<!-- mdmini:c id={id} status={status} line={line} -->\n{quoted}\n**{author}** · {at}\n{text}\n",
        status = status.as_str()
    )
}

/// Добавить новый тред в конец файла, создав файл с заголовком при необходимости.
pub fn append_thread(
    doc: &Path,
    id: &str,
    line: usize,
    quote: &str,
    author: &str,
    text: &str,
) -> Result<(), String> {
    guard_not_sidecar(doc)?;
    let path = sidecar_path(doc).ok_or_else(|| "bad document path".to_string())?;
    let doc_name = doc
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad document path".to_string())?;

    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut out = if existing.trim().is_empty() {
        format!("<!-- mdmini:comments v=1 doc={doc_name} -->\n")
    } else {
        let mut e = existing;
        if !e.ends_with('\n') {
            e.push('\n');
        }
        e
    };
    out.push('\n');
    out.push_str(&render_thread(
        id,
        Status::Open,
        line,
        quote,
        author,
        &fmt_utc(now_epoch()),
        text,
    ));
    write_atomic(&path, &out)
}

/// Найти строку-маркер треда по id. Возвращает индекс строки.
fn marker_line_index(lines: &[&str], id: &str) -> Option<usize> {
    lines.iter().position(|line| {
        line.trim_start().starts_with(THREAD_MARKER) && line.contains(&format!("id={id} "))
    })
}

/// Дописать реплику в конец указанного треда и перевести его в `answered`.
///
/// Вставка идёт перед следующим маркером треда (или в конец файла), поэтому
/// остальной файл не переписывается — важно, раз его правят руками.
pub fn append_reply(doc: &Path, id: &str, author: &str, text: &str) -> Result<(), String> {
    let path = sidecar_path(doc).ok_or_else(|| "bad document path".to_string())?;
    let existing = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let lines: Vec<&str> = existing.lines().collect();
    let start = marker_line_index(&lines, id).ok_or_else(|| format!("unknown comment id: {id}"))?;

    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, line)| line.trim_start().starts_with(THREAD_MARKER))
        .map(|(i, _)| i)
        .unwrap_or(lines.len());

    let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    out[start] = out[start].replace(
        &format!("status={}", status_in_marker(&out[start])),
        &format!("status={}", Status::Answered.as_str()),
    );

    let block = format!("\n**{author}** · {}\n{text}", fmt_utc(now_epoch()));
    let mut insert_at = end;
    while insert_at > start + 1 && out[insert_at - 1].trim().is_empty() {
        insert_at -= 1;
    }
    for (offset, line) in block.lines().enumerate() {
        out.insert(insert_at + offset, line.to_string());
    }

    write_atomic(&path, &format!("{}\n", out.join("\n")))
}

/// Прочитать значение `status=` из строки-маркера; `open`, если атрибут потерян.
fn status_in_marker(line: &str) -> &str {
    line.split_whitespace()
        .find_map(|pair| pair.strip_prefix("status="))
        .unwrap_or("open")
}

/// Поменять статус треда, переписав ровно одну строку-маркер.
pub fn set_status(doc: &Path, id: &str, status: Status) -> Result<(), String> {
    let path = sidecar_path(doc).ok_or_else(|| "bad document path".to_string())?;
    let existing = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let lines: Vec<&str> = existing.lines().collect();
    let index = marker_line_index(&lines, id).ok_or_else(|| format!("unknown comment id: {id}"))?;

    let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    let old = status_in_marker(&out[index]).to_string();
    out[index] = out[index].replace(&format!("status={old}"), &format!("status={}", status.as_str()));
    write_atomic(&path, &format!("{}\n", out.join("\n")))
}
```

- [ ] **Step 4: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml comments::`
Expected: PASS, пятнадцать тестов.

- [ ] **Step 5: Clippy и коммит**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/comments.rs
git commit -m "feat(comments): append threads and replies, flip status, atomic writes"
```

---

## Task 4: CLI-вербы question и answer

**Files:**
- Modify: `src-tauri/src/ai_socket.rs:659-690` (`CliVerb`), `:692+` (`parse_cli_args`), `:1107+` (`run_ai_cli`), `USAGE`
- Modify: `scripts/mdmini:12`

- [ ] **Step 1: Написать падающие тесты парсинга**

Добавить в существующий `mod tests` в `ai_socket.rs`:

```rust
    #[test]
    fn parses_question_with_optional_path() {
        let args = vec!["question".to_string(), "/repo/spec.md".to_string()];
        let parsed = parse_cli_args(&args).unwrap();
        assert_eq!(parsed.verb, CliVerb::Question);
        assert_eq!(parsed.path, "/repo/spec.md");
    }

    #[test]
    fn parses_question_without_path() {
        let args = vec!["question".to_string()];
        let parsed = parse_cli_args(&args).unwrap();
        assert_eq!(parsed.verb, CliVerb::Question);
        assert_eq!(parsed.path, "");
    }

    #[test]
    fn parses_answer_with_id() {
        let args = vec![
            "answer".to_string(),
            "/repo/spec.md".to_string(),
            "--id".to_string(),
            "c-7f3a2c".to_string(),
        ];
        let parsed = parse_cli_args(&args).unwrap();
        assert_eq!(
            parsed.verb,
            CliVerb::Answer {
                id: "c-7f3a2c".to_string()
            }
        );
    }

    #[test]
    fn answer_without_id_is_a_usage_error() {
        let args = vec!["answer".to_string(), "/repo/spec.md".to_string()];
        assert!(parse_cli_args(&args).is_err());
    }
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai_socket::`
Expected: FAIL, `no variant named Question`.

- [ ] **Step 3: Добавить варианты и парсинг**

В `enum CliVerb` (после `Agent { mcp: bool },`):

```rust
    /// Локальная офлайновая верба: печатает открытые треды комментариев.
    /// Путь необязателен — без него берутся треды всех документов под cwd.
    Question,
    /// Локальная офлайновая верба: дописывает ответ в тред. Текст со stdin.
    Answer { id: String },
    /// Локальная офлайновая верба: поток событий для Monitor.
    Watch,
```

В `parse_cli_args`, сразу после блока `if verb == "agent" { ... }`:

```rust
    if verb == "question" || verb == "watch" {
        // Путь (или каталог для `watch`) необязателен: пусто = cwd.
        let path = iter.next().cloned().unwrap_or_default();
        if let Some(extra) = iter.next() {
            return Err(format!("{verb} takes at most one path: unexpected {extra}"));
        }
        return Ok(CliArgs {
            path,
            verb: if verb == "question" {
                CliVerb::Question
            } else {
                CliVerb::Watch
            },
            socket: None,
        });
    }
    if verb == "answer" {
        let path = iter.next().ok_or_else(|| USAGE.to_string())?.clone();
        let mut id: Option<String> = None;
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--id" => id = iter.next().cloned(),
                other => return Err(format!("unknown flag for answer: {other}")),
            }
        }
        let id = id.ok_or_else(|| "answer requires --id".to_string())?;
        return Ok(CliArgs {
            path,
            verb: CliVerb::Answer { id },
            socket: None,
        });
    }
```

Расширить `USAGE`, добавив в конец строки:

```
\n       mdmini ai question [<file>]\n       mdmini ai answer <file> --id ID\n       mdmini ai watch [<dir>]
```

- [ ] **Step 4: Прогнать — падает на неполном match**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai_socket::`
Expected: FAIL, non-exhaustive match в `run_ai_cli` (`Question`/`Answer`/`Watch` не покрыты).

- [ ] **Step 5: Обработать вербы в run_ai_cli**

В `run_ai_cli`, в блоке ранних локальных верб (там, где `CliVerb::Help` и `CliVerb::Agent`), добавить перед `_ => {}`:

```rust
        CliVerb::Question => {
            let root = if parsed.path.is_empty() {
                std::env::current_dir().unwrap_or_default()
            } else {
                PathBuf::from(crate::resolve_path(&parsed.path, None))
            };
            let threads = crate::comments::collect_open(&root);
            println!("{}", serde_json::to_string(&threads).unwrap());
            return 0;
        }
        CliVerb::Watch => {
            let root = if parsed.path.is_empty() {
                std::env::current_dir().unwrap_or_default()
            } else {
                PathBuf::from(crate::resolve_path(&parsed.path, None))
            };
            return crate::watch::run(&root);
        }
        CliVerb::Answer { ref id } => {
            let doc = PathBuf::from(crate::resolve_path(&parsed.path, None));
            let mut text = String::new();
            if std::io::stdin().read_to_string(&mut text).is_err() {
                println!("{}", serde_json::to_string(&AiResponse::error("failed to read stdin")).unwrap());
                return 2;
            }
            if text.trim().is_empty() {
                println!("{}", serde_json::to_string(&AiResponse::error("refusing to post an empty answer")).unwrap());
                return 2;
            }
            return match crate::comments::append_reply(&doc, id, "agent", text.trim()) {
                Ok(()) => {
                    println!("{}", serde_json::to_string(&AiResponse::ok()).unwrap());
                    0
                }
                Err(e) => {
                    println!("{}", serde_json::to_string(&AiResponse::error(&e)).unwrap());
                    1
                }
            };
        }
```

Также обновить `unreachable!` в нижнем `match parsed.verb`, добавив новые вербы к списку тех, что возвращаются раньше:

```rust
        CliVerb::Help
        | CliVerb::Agent { .. }
        | CliVerb::Question
        | CliVerb::Answer { .. }
        | CliVerb::Watch => {
            unreachable!("local verbs return early above, before this match")
        }
```

- [ ] **Step 6: Написать падающий тест на collect_open**

В `comments.rs`:

```rust
    #[test]
    fn collect_open_walks_the_tree_and_returns_only_open_threads() {
        let doc = temp_doc("spec.md");
        append_thread(&doc, "c-open01", 1, "q1", "Макс", "Открыт?").unwrap();
        append_thread(&doc, "c-done01", 2, "q2", "Макс", "Закрыт?").unwrap();
        set_status(&doc, "c-done01", Status::Resolved).unwrap();

        let found = collect_open(doc.parent().unwrap());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].thread.id, "c-open01");
        assert_eq!(found[0].doc, doc);
    }
```

- [ ] **Step 7: Реализовать collect_open**

В `comments.rs`:

```rust
/// Тред вместе с документом, к которому он относится.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Located {
    pub doc: PathBuf,
    pub thread: Thread,
}

/// Обойти дерево каталогов и собрать все треды со статусом `open`.
///
/// Скоуп задаётся деревом, а не набором открытых окон: `question` и `watch`
/// работают при закрытом приложении, и cwd агента естественно ограничивает
/// выборку без всякой отдельной логики скоупа.
pub fn collect_open(root: &Path) -> Vec<Located> {
    let mut out = Vec::new();
    collect_open_into(root, &mut out, 0);
    out.sort_by(|a, b| a.doc.cmp(&b.doc).then(a.thread.id.cmp(&b.thread.id)));
    out
}

fn collect_open_into(dir: &Path, out: &mut Vec<Located>, depth: usize) {
    if depth > 24 {
        return; // защита от символических циклов
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            // Не ходим в каталоги, которые заведомо не содержат документов
            // пользователя и стоят дорого.
            if matches!(name.as_ref(), ".git" | "node_modules" | "target") {
                continue;
            }
            collect_open_into(&path, out, depth + 1);
            continue;
        }
        if !is_sidecar(&path) {
            continue;
        }
        let Some(doc_name) = name.strip_prefix(".mdmini_comments_") else {
            continue;
        };
        let doc = path.with_file_name(doc_name);
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for thread in parse(&text) {
            if thread.status == Status::Open {
                out.push(Located {
                    doc: doc.clone(),
                    thread,
                });
            }
        }
    }
}
```

- [ ] **Step 8: Добавить вербы в scripts/mdmini**

Заменить строку 12 (`if [ "$1" = "help" ] || [ "$1" = "agent" ]; then`) на:

```bash
# `mdmini help` / `agent` / `question` / `answer` / `watch` локальны и офлайновы
# (ни сокета, ни запущенного приложения) — сразу отдаём бинарнику в `ai`-клиент,
# минуя launch-wait ниже. Комментарии живут в файлах рядом с документом, поэтому
# question/answer/watch не зависят от того, открыт ли md-mini.
if [ "$1" = "help" ] || [ "$1" = "agent" ] || [ "$1" = "question" ] || [ "$1" = "answer" ] || [ "$1" = "watch" ]; then
  exec "$BIN" ai "$@"
fi
```

- [ ] **Step 9: Прогнать всё и закоммитить**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/ai_socket.rs src-tauri/src/comments.rs scripts/mdmini
git commit -m "feat(ai): question and answer as local offline CLI verbs"
```

Expected: все тесты проходят, clippy чист.

---

## Task 5: watch.rs — поток событий для Monitor

**Files:**
- Create: `src-tauri/src/watch.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod watch;`)

- [ ] **Step 1: Написать падающие тесты на чистую логику дедупликации**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn located(id: &str) -> crate::comments::Located {
        crate::comments::Located {
            doc: PathBuf::from("/repo/spec.md"),
            thread: crate::comments::Thread {
                id: id.to_string(),
                status: crate::comments::Status::Open,
                line: 1,
                quote: "цитата".to_string(),
                replies: vec![crate::comments::Reply {
                    author: "Макс".to_string(),
                    at: "2026-08-24 14:02".to_string(),
                    text: "Вопрос?".to_string(),
                }],
            },
        }
    }

    #[test]
    fn first_sighting_emits_and_second_is_silent() {
        let mut seen = Seen::default();
        assert_eq!(seen.newly_open(&[located("c-aaaaaa")]).len(), 1);
        assert!(seen.newly_open(&[located("c-aaaaaa")]).is_empty());
    }

    #[test]
    fn a_thread_that_leaves_and_returns_to_open_emits_again() {
        let mut seen = Seen::default();
        assert_eq!(seen.newly_open(&[located("c-aaaaaa")]).len(), 1);
        // Агент ответил — треда больше нет в open-выборке.
        assert!(seen.newly_open(&[]).is_empty());
        // Человек дописал уточнение — тред снова open, это новое событие.
        assert_eq!(seen.newly_open(&[located("c-aaaaaa")]).len(), 1);
    }

    #[test]
    fn event_line_carries_file_id_quote_and_question() {
        let line = event_line(&located("c-aaaaaa"));
        assert!(line.contains("spec.md"));
        assert!(line.contains("c-aaaaaa"));
        assert!(line.contains("цитата"));
        assert!(line.contains("Вопрос?"));
        assert!(!line.contains('\n'), "ровно одна строка: {line}");
    }

    #[test]
    fn multiline_text_is_flattened_into_one_line() {
        let mut l = located("c-aaaaaa");
        l.thread.replies[0].text = "первая\nвторая".to_string();
        let line = event_line(&l);
        assert!(!line.contains('\n'));
        assert!(line.contains("первая"));
        assert!(line.contains("вторая"));
    }
}
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml watch::`
Expected: FAIL, модуль не существует.

- [ ] **Step 3: Реализовать watch.rs**

```rust
//! `mdmini watch` — поток событий о новых комментариях, предназначенный для
//! Claude Code Monitor: каждая строка stdout будит живую сессию агента.
//!
//! Сознательно не ходит в командный сокет: источник истины — файлы
//! `.mdmini_comments_*.md`, поэтому доставка работает и при закрытом
//! приложении, а скоуп задаётся деревом каталогов, то есть совпадает с cwd
//! агента без отдельной логики скоупа.
//!
//! Флуд-контроль здесь не оптимизация, а условие работоспособности: Monitor
//! останавливает слишком болтливый монитор, и агент об этом не узнаёт. Поэтому
//! строка печатается ровно один раз на переход треда в `open`.

use std::collections::HashSet;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};

use crate::comments::Located;

/// Уже отданные наружу треды. Живёт в памяти процесса-монитора.
#[derive(Default)]
pub struct Seen {
    emitted: HashSet<String>,
}

impl Seen {
    /// Отобрать те треды, о которых ещё не сообщали. Тред, ушедший из выборки
    /// (получил ответ или закрыт) забывается, поэтому вернувшийся в `open`
    /// тред — это снова событие: человек дописал уточнение и ждёт ответа.
    pub fn newly_open<'a>(&mut self, open: &'a [Located]) -> Vec<&'a Located> {
        let current: HashSet<String> = open.iter().map(|l| l.thread.id.clone()).collect();
        self.emitted.retain(|id| current.contains(id));

        let mut fresh = Vec::new();
        for located in open {
            if self.emitted.insert(located.thread.id.clone()) {
                fresh.push(located);
            }
        }
        fresh
    }
}

/// Одна строка события. Всё в одну строку: Monitor батчит вывод по 200мс, и
/// многострочное событие смешалось бы с соседним.
pub fn event_line(located: &Located) -> String {
    let question = located
        .thread
        .replies
        .last()
        .map(|r| r.text.replace('\n', " ⏎ "))
        .unwrap_or_default();
    format!(
        "[mdmini] {} {} · «{}» · {}",
        located.doc.display(),
        located.thread.id,
        located.thread.quote.replace('\n', " "),
        question
    )
}

/// Запустить наблюдение. Возвращает код выхода процесса.
pub fn run(root: &Path) -> i32 {
    let (tx, rx) = mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("failed to start watcher: {e}");
            return 2;
        }
    };
    if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
        eprintln!("failed to watch {}: {e}", root.display());
        return 2;
    }

    let mut seen = Seen::default();
    // Первый проход: уже лежащие open-треды — это тоже события. Агент,
    // повесивший монитор посреди работы, должен узнать про накопленное.
    emit(&mut seen, root);

    loop {
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(Ok(event)) => {
                let touched_sidecar = event
                    .paths
                    .iter()
                    .any(|p| crate::comments::is_sidecar(p));
                if touched_sidecar {
                    // Небольшая задержка: атомарная запись — это create+rename,
                    // и без неё можно прочитать файл между двумя событиями.
                    std::thread::sleep(Duration::from_millis(50));
                    emit(&mut seen, root);
                }
            }
            Ok(Err(e)) => eprintln!("watch error: {e}"),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Периодическая ресинхронизация: fsevents умеет терять события
                // при массовых операциях (переключение ветки, git checkout).
                emit(&mut seen, root);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return 0,
        }
    }
}

fn emit(seen: &mut Seen, root: &Path) {
    let open = crate::comments::collect_open(root);
    for located in seen.newly_open(&open) {
        println!("{}", event_line(located));
    }
    use std::io::Write;
    let _ = std::io::stdout().flush();
}
```

Добавить в `lib.rs`:

```rust
pub mod watch;
```

- [ ] **Step 4: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml watch::`
Expected: PASS, четыре теста.

- [ ] **Step 5: Проверить руками, что поток действительно течёт**

```bash
cd /tmp && rm -rf watch-smoke && mkdir watch-smoke && cd watch-smoke
printf '# doc\n\ntext line\n' > doc.md
cargo run --manifest-path /path/to/src-tauri/Cargo.toml -- ai watch . &
sleep 1
printf '<!-- mdmini:comments v=1 doc=doc.md -->\n\n<!-- mdmini:c id=c-smoke1 status=open line=3 -->\n> text line\n\n**Макс** · now\nПочему?\n' > .mdmini_comments_doc.md
sleep 2
kill %1
```

Expected: одна строка вида `[mdmini] /tmp/watch-smoke/doc.md c-smoke1 · «text line» · Почему?` и ни одной повторной.

- [ ] **Step 6: Clippy и коммит**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/watch.rs src-tauri/src/lib.rs
git commit -m "feat(watch): stream one event per newly-open comment thread"
```

---

## Task 6: MCP-тулы question и answer

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Прочитать существующий паттерн**

Прочитать в `mcp_server.rs` построение массива `tools/list` и диспетчер `tools/call`. Новые тулы обязаны следовать тому же способу собирать `inputSchema` и оборачивать результат, включая правило `isError: true` при `"ok": false`.

- [ ] **Step 2: Написать падающие тесты**

```rust
    #[test]
    fn tools_list_includes_question_and_answer() {
        let response = handle_message(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list"
        }).to_string());
        let value: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        let names: Vec<String> = value["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        assert!(names.contains(&"question".to_string()));
        assert!(names.contains(&"answer".to_string()));
    }

    #[test]
    fn answer_without_id_is_invalid_params() {
        let response = handle_message(&json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "answer", "arguments": {"path": "/repo/spec.md", "text": "hi"}}
        }).to_string());
        let value: serde_json::Value = serde_json::from_str(&response.unwrap()).unwrap();
        assert_eq!(value["error"]["code"], -32602);
    }
```

Имя функции-обработчика взять из существующего кода — в тестах использовать ровно ту, что уже тестируется для `show`/`edit`/`ask`.

- [ ] **Step 3: Прогнать — FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp_server::`
Expected: FAIL — тулов нет в списке.

- [ ] **Step 4: Добавить тулы**

В массив `tools/list` добавить два элемента по образцу существующих:

```rust
        json!({
            "name": "question",
            "description": "List open comment threads the user left in documents. Reads .mdmini_comments_*.md files directly — works even when md-mini is not running.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Document or directory to look under. Defaults to the current working directory."
                    }
                },
                "required": []
            }
        }),
        json!({
            "name": "answer",
            "description": "Append a reply to a comment thread and mark it answered. If the document itself needs changing, use edit first, then answer to close the thread.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path of the commented document."},
                    "id": {"type": "string", "description": "Thread id, e.g. c-7f3a2c."},
                    "text": {"type": "string", "description": "The reply text."}
                },
                "required": ["path", "id", "text"]
            }
        }),
```

В диспетчере `tools/call` добавить ветки, вызывающие `comments` напрямую — **без сокета и без launch-if-not-running**, в отличие от `show`/`edit`/`ask`:

```rust
        "question" => {
            let root = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let threads = crate::comments::collect_open(&root);
            let text = serde_json::to_string(&threads).unwrap_or_else(|_| "[]".to_string());
            tool_result(&text, false)
        }
        "answer" => {
            let (Some(path), Some(id), Some(text)) = (
                arguments.get("path").and_then(|v| v.as_str()),
                arguments.get("id").and_then(|v| v.as_str()),
                arguments.get("text").and_then(|v| v.as_str()),
            ) else {
                return invalid_params(id_value, "answer requires path, id and text");
            };
            match crate::comments::append_reply(std::path::Path::new(path), id, "agent", text) {
                Ok(()) => tool_result("{\"ok\":true}", false),
                Err(e) => tool_result(
                    &serde_json::to_string(&crate::ai_socket::AiResponse::error(&e)).unwrap(),
                    true,
                ),
            }
        }
```

Имена хелперов `tool_result` и `invalid_params` заменить на те, что реально существуют в файле — взять из ветки `show`.

- [ ] **Step 5: Прогнать — проходит**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp_server::`
Expected: PASS.

- [ ] **Step 6: Проверить руками через stdio**

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | cargo run --manifest-path src-tauri/Cargo.toml -- mcp | python3 -c "import sys,json; print([t['name'] for t in json.load(sys.stdin)['result']['tools']])"
```

Expected: `['show', 'edit', 'ask', 'question', 'answer']`

- [ ] **Step 7: Clippy и коммит**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git add src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): question and answer tools reading the comment files directly"
```

---

## Task 7: comment-format.ts — чистый фронтовый модуль

**Files:**
- Create: `src/lib/comment-format.ts`
- Test: `src/lib/comment-format.test.ts`

Зеркалит существующую пару `src/lib/ai-commands.ts` + `src/lib/ai-commands.test.ts`: чистые функции, тестируемые без CodeMirror и без Tauri.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, it } from 'vitest';
import { anchorPosition, buildHandoffPrompt, parseComments } from './comment-format';

const SAMPLE = `<!-- mdmini:comments v=1 doc=spec.md -->

<!-- mdmini:c id=c-7f3a2c status=open line=3 -->
> We ship via Caddy

**Макс** · 2026-08-24 14:02
Почему не nginx?

**agent** · 2026-08-24 14:05
Он был сломан.
`;

describe('parseComments', () => {
  it('reads threads, status, quote and replies', () => {
    const threads = parseComments(SAMPLE);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('c-7f3a2c');
    expect(threads[0].status).toBe('open');
    expect(threads[0].line).toBe(3);
    expect(threads[0].quote).toBe('We ship via Caddy');
    expect(threads[0].replies).toHaveLength(2);
    expect(threads[0].replies[1].author).toBe('agent');
    expect(threads[0].replies[1].text).toBe('Он был сломан.');
  });

  it('returns an empty list for an empty file', () => {
    expect(parseComments('')).toEqual([]);
  });

  it('skips a thread whose marker has no id', () => {
    expect(parseComments('<!-- mdmini:c status=open line=1 -->\n> q\n')).toEqual([]);
  });
});

describe('anchorPosition', () => {
  const doc = 'first\nWe ship via Caddy\nthird\n';

  it('finds the quote and returns its offset', () => {
    expect(anchorPosition(doc, 'We ship via Caddy', 2)).toEqual({ pos: 6, orphaned: false });
  });

  it('falls back to the stored line when the quote is gone', () => {
    const result = anchorPosition(doc, 'nothing like this', 3);
    expect(result.orphaned).toBe(true);
    expect(result.pos).toBe(24);
  });

  it('clamps a stored line beyond the end of the document', () => {
    const result = anchorPosition(doc, 'absent', 999);
    expect(result.orphaned).toBe(true);
    expect(result.pos).toBeLessThanOrEqual(doc.length);
  });
});

describe('buildHandoffPrompt', () => {
  it('names the comment file, the document and the thread id', () => {
    const prompt = buildHandoffPrompt('/repo/spec.md', 'c-7f3a2c');
    expect(prompt).toContain('/repo/.mdmini_comments_spec.md');
    expect(prompt).toContain('/repo/spec.md');
    expect(prompt).toContain('c-7f3a2c');
    expect(prompt).toContain('mdmini answer');
  });
});
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `npx vitest run --dir src src/lib/comment-format.test.ts`
Expected: FAIL, `Failed to resolve import './comment-format'`.

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * Чистые помощники для слоя комментариев. Формат файла — контракт, в который
 * пишут и Rust, и агенты, и человек руками, поэтому парсер здесь терпимый:
 * непонятный тред пропускается, остальные возвращаются.
 *
 * Ничего из Tauri и CodeMirror — модуль тестируется в изоляции.
 */

export type CommentStatus = 'open' | 'answered' | 'resolved';

export interface CommentReply {
  author: string;
  at: string;
  text: string;
}

export interface CommentThread {
  id: string;
  status: CommentStatus;
  /** Номер строки на момент записи — подсказка, а не истина. */
  line: number;
  quote: string;
  replies: CommentReply[];
}

const THREAD_MARKER = '<!-- mdmini:c ';

function parseMarker(line: string): Pick<CommentThread, 'id' | 'status' | 'line'> | null {
  const inner = line.trim().slice(THREAD_MARKER.length).replace(/-->$/, '').trim();
  let id = '';
  let status: CommentStatus | '' = '';
  let lineNumber = 1;
  for (const pair of inner.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'id') id = value;
    else if (key === 'status' && (value === 'open' || value === 'answered' || value === 'resolved')) {
      status = value;
    } else if (key === 'line') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) lineNumber = parsed;
    }
  }
  if (!id || !status) return null;
  return { id, status, line: lineNumber };
}

function parseReplyHeader(line: string): { author: string; at: string } | null {
  const match = /^\*\*([^*]+)\*\*\s+·\s+(.+)$/.exec(line);
  if (!match) return null;
  return { author: match[1], at: match[2].trim() };
}

/** Разобрать содержимое файла комментариев. */
export function parseComments(text: string): CommentThread[] {
  const threads: CommentThread[] = [];
  let current: CommentThread | null = null;
  let reply: CommentReply | null = null;
  let skipping = false;

  const flushReply = () => {
    if (current && reply) {
      reply.text = reply.text.replace(/\s+$/, '');
      current.replies.push(reply);
    }
    reply = null;
  };

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith(THREAD_MARKER)) {
      flushReply();
      if (current) threads.push(current);
      const marker = parseMarker(line);
      skipping = marker === null;
      current = marker ? { ...marker, quote: '', replies: [] } : null;
      continue;
    }
    if (skipping || !current) continue;

    if (!reply && line.startsWith('> ')) {
      current.quote = current.quote ? `${current.quote}\n${line.slice(2).trimEnd()}` : line.slice(2).trimEnd();
      continue;
    }

    const header = parseReplyHeader(line);
    if (header) {
      flushReply();
      reply = { ...header, text: '' };
      continue;
    }

    if (reply) {
      if (!line.trim() && !reply.text) continue;
      reply.text = reply.text ? `${reply.text}\n${line}` : line;
    }
  }

  flushReply();
  if (current) threads.push(current);
  return threads;
}

/**
 * Где рисовать тред. Привязка идёт поиском цитаты; сохранённый номер строки —
 * только fallback, потому что текст мог сдвинуться. Не нашли цитату — тред не
 * исчезает, а помечается отвязанным: молча уехать он не должен.
 */
export function anchorPosition(
  doc: string,
  quote: string,
  line: number
): { pos: number; orphaned: boolean } {
  const firstQuoteLine = quote.split('\n')[0];
  if (firstQuoteLine) {
    const found = doc.indexOf(firstQuoteLine);
    if (found >= 0) return { pos: found, orphaned: false };
  }
  const lines = doc.split('\n');
  const index = Math.max(0, Math.min(line - 1, lines.length - 1));
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += lines[i].length + 1;
  return { pos: Math.min(pos, doc.length), orphaned: true };
}

/** Путь файла комментариев для документа — то же правило, что в Rust. */
export function sidecarPath(docPath: string): string {
  const slash = docPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : docPath.slice(0, slash + 1);
  const name = slash < 0 ? docPath : docPath.slice(slash + 1);
  return `${dir}.mdmini_comments_${name}`;
}

/**
 * Текст для кнопки «отправить в агента»: вставляется в чат любому агенту,
 * включая тех, у кого нет ни MCP, ни механизма пробуждения.
 */
export function buildHandoffPrompt(docPath: string, id: string): string {
  return [
    `В файле ${sidecarPath(docPath)} есть открытый комментарий ${id} к ${docPath}.`,
    `Прочитай тред и ответь: допиши реплику под ним и поменяй status на answered.`,
    `Если нужна правка самого документа — примени её, затем ответь в тред.`,
    `С MCP md-mini: инструменты question и answer. Из CLI: mdmini answer ${docPath} --id ${id} (текст на stdin).`,
  ].join('\n');
}
```

- [ ] **Step 4: Прогнать — проходит**

Run: `npx vitest run --dir src src/lib/comment-format.test.ts`
Expected: PASS, все тесты.

- [ ] **Step 5: Типы и коммит**

```bash
npm run check
git add src/lib/comment-format.ts src/lib/comment-format.test.ts
git commit -m "feat(comments): pure frontend parser, quote anchoring and handoff prompt"
```

---

## Task 8: ai-comment.ts — блок-виджет треда

**Files:**
- Create: `src/lib/editor/ai-comment.ts`
- Test: `src/lib/editor/ai-comment.test.ts`
- Modify: `src/lib/editor/setup.ts:24-25` (импорт), `:37-39` (сборка расширений)
- Modify: `src/styles/editor.css` (в конец файла)

Зеркалит `src/lib/editor/ai-ask.ts`. Обязательные к воспроизведению решения оттуда:

- `Decoration.widget({ widget, block: true, side: 1 })`, привязка к `state.doc.lineAt(pos).to`.
- `deco.map(tr.changes)` в начале `update`, чтобы виджет ехал с текстом.
- `ignoreEvent(): true`.
- Внешняя обёртка `.cm-ai-comment-wrap` несёт отступы **padding**, у карточки `.cm-ai-comment` margin нулевой. Иначе CM6 измерит высоту виджета без margin, и `posAtCoords` перестанет находить строки ниже.
- На кнопках `mousedown` → `preventDefault()`, чтобы клик не двигал выделение. На фокусируемом `input` — `stopPropagation()` на всех клавиатурных событиях (`keydown`, `keypress`, `keyup`) и на `mousedown`, но **без** `preventDefault` на `mousedown`: иначе браузер не поставит каретку в поле.

**В репозитории нет jsdom и happy-dom.** Поэтому тесты ниже вызывают только `eq()` и работу StateField — через `EditorState.create()` и `state.update({effects})`, без `EditorView`. Если понадобится протестировать `toDOM`, брать готовый харнес из `src/lib/editor/ai-ask.test.ts` (там `FakeElement` + `vi.stubGlobal('document', {createElement: createFakeElement})` и хелпер `findByClass`, матчащий класс по слову, а не по строке — иначе двухтокенный `className` не найдётся). Не тащить новую зависимость ради DOM.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { CommentThread } from '../comment-format';
import { CommentWidget, addAiComment, aiCommentField, removeAiComment } from './ai-comment';

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 'c-7f3a2c',
    status: 'open',
    line: 1,
    quote: 'первая',
    replies: [{ author: 'Макс', at: '14:02', text: 'Почему?' }],
    ...overrides,
  };
}

function stateWith(threads: CommentThread[]): EditorState {
  const state = EditorState.create({ doc: 'первая\nвторая\n', extensions: [aiCommentField] });
  return state.update({
    effects: threads.map((t) => addAiComment.of({ thread: t, pos: 0, orphaned: false })),
  }).state;
}

describe('aiCommentField', () => {
  it('adds one widget per thread', () => {
    const state = stateWith([thread()]);
    let count = 0;
    state.field(aiCommentField).between(0, state.doc.length, () => {
      count += 1;
    });
    expect(count).toBe(1);
  });

  it('removes a widget by id', () => {
    let state = stateWith([thread()]);
    state = state.update({ effects: removeAiComment.of('c-7f3a2c') }).state;
    let count = 0;
    state.field(aiCommentField).between(0, state.doc.length, () => {
      count += 1;
    });
    expect(count).toBe(0);
  });
});

describe('CommentWidget.eq', () => {
  it('is equal for the same thread content', () => {
    const a = new CommentWidget({ thread: thread(), orphaned: false, actions: {} as never });
    const b = new CommentWidget({ thread: thread(), orphaned: false, actions: {} as never });
    expect(a.eq(b)).toBe(true);
  });

  it('differs when the status changes', () => {
    const a = new CommentWidget({ thread: thread(), orphaned: false, actions: {} as never });
    const b = new CommentWidget({ thread: thread({ status: 'answered' }), orphaned: false, actions: {} as never });
    expect(a.eq(b)).toBe(false);
  });

  it('differs when a reply is added', () => {
    const withReply = thread({
      replies: [
        { author: 'Макс', at: '14:02', text: 'Почему?' },
        { author: 'agent', at: '14:05', text: 'Потому.' },
      ],
    });
    const a = new CommentWidget({ thread: thread(), orphaned: false, actions: {} as never });
    const b = new CommentWidget({ thread: withReply, orphaned: false, actions: {} as never });
    expect(a.eq(b)).toBe(false);
  });

  it('differs when the anchor became orphaned', () => {
    const a = new CommentWidget({ thread: thread(), orphaned: false, actions: {} as never });
    const b = new CommentWidget({ thread: thread(), orphaned: true, actions: {} as never });
    expect(a.eq(b)).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `npx vitest run --dir src src/lib/editor/ai-comment.test.ts`
Expected: FAIL, `Failed to resolve import './ai-comment'`.

- [ ] **Step 3: Реализовать виджет**

```ts
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { CommentThread } from '../comment-format';

/** Что виджет умеет попросить сделать снаружи. */
export interface CommentActions {
  reply: (id: string, text: string) => void;
  resolve: (id: string) => void;
  handoff: (id: string) => void;
  insertIntoText: (id: string, text: string) => void;
}

export interface CommentSpec {
  thread: CommentThread;
  /** Цитата не найдена в документе — тред показан у сохранённой строки. */
  orphaned: boolean;
  actions: CommentActions;
}

export const addAiComment = StateEffect.define<{
  thread: CommentThread;
  pos: number;
  orphaned: boolean;
}>();

export const removeAiComment = StateEffect.define<string>();

/** Убрать все виджеты — используется при перезагрузке файла комментариев. */
export const clearAiComments = StateEffect.define<null>();

const STATUS_LABEL: Record<CommentThread['status'], string> = {
  open: 'ждёт агента',
  answered: 'есть ответ',
  resolved: 'решено',
};

export class CommentWidget extends WidgetType {
  constructor(readonly spec: CommentSpec) {
    super();
  }

  eq(other: CommentWidget): boolean {
    const a = this.spec.thread;
    const b = other.spec.thread;
    return (
      a.id === b.id &&
      a.status === b.status &&
      a.quote === b.quote &&
      this.spec.orphaned === other.spec.orphaned &&
      a.replies.length === b.replies.length &&
      a.replies.every(
        (reply, i) =>
          reply.author === b.replies[i].author &&
          reply.at === b.replies[i].at &&
          reply.text === b.replies[i].text
      )
    );
  }

  toDOM(): HTMLElement {
    const { thread, orphaned, actions } = this.spec;

    // CM6 измеряет высоту блок-виджета по DOM-боксу корневого элемента, а
    // margin в него не входит. Поэтому вертикальные отступы живут здесь, в
    // padding обёртки, а сама карточка margin не несёт — иначе карта высот
    // разъедется с реальным DOM и ArrowUp/Down начнут перескакивать строки.
    const wrap = document.createElement('div');
    wrap.className = 'cm-ai-comment-wrap';

    const card = document.createElement('div');
    card.className = orphaned ? 'cm-ai-comment cm-ai-comment-orphaned' : 'cm-ai-comment';

    const head = document.createElement('div');
    head.className = 'cm-ai-comment-head';
    head.textContent = orphaned
      ? `${thread.id} · якорь потерян`
      : `${thread.id} · ${STATUS_LABEL[thread.status]}`;
    card.appendChild(head);

    for (const reply of thread.replies) {
      const item = document.createElement('div');
      item.className = 'cm-ai-comment-reply';

      const who = document.createElement('div');
      who.className = 'cm-ai-comment-author';
      who.textContent = `${reply.author} · ${reply.at}`;
      item.appendChild(who);

      const body = document.createElement('div');
      body.className = 'cm-ai-comment-text';
      body.textContent = reply.text;
      item.appendChild(body);

      card.appendChild(item);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cm-ai-comment-input';
    input.placeholder = 'Ответить…';
    // ignoreEvent() гасит только собственную обработку CM6 — до
    // document-level слушателей (Escape-хендлеры, таблицы) событие всё равно
    // дойдёт. Настоящему input нужен явный stopPropagation на каждом
    // клавиатурном событии. На mousedown — stopPropagation, но НЕ
    // preventDefault: иначе браузер не поставит каретку в поле.
    input.addEventListener('mousedown', (event) => event.stopPropagation());
    input.addEventListener('keypress', (event) => event.stopPropagation());
    input.addEventListener('keyup', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      const text = input.value.trim();
      if (text) actions.reply(thread.id, text);
    });
    card.appendChild(input);

    const row = document.createElement('div');
    row.className = 'cm-ai-comment-actions';

    const button = (label: string, onClick: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cm-ai-comment-button';
      element.textContent = label;
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', onClick);
      row.appendChild(element);
    };

    button('отправить в агента', () => actions.handoff(thread.id));
    const last = thread.replies[thread.replies.length - 1];
    if (thread.status === 'answered' && last) {
      button('вставить в текст', () => actions.insertIntoText(thread.id, last.text));
    }
    if (thread.status !== 'resolved') {
      button('решено', () => actions.resolve(thread.id));
    }
    card.appendChild(row);

    wrap.appendChild(card);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function isCommentWidget(widget: WidgetType): widget is CommentWidget {
  return widget instanceof CommentWidget;
}

/**
 * Один блок-виджет на тред. Диапазоны мапятся через правки, поэтому виджет
 * остаётся у своей строки, пока человек печатает рядом.
 */
export const aiCommentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addAiComment)) {
        const { thread, pos, orphaned } = effect.value;
        const clamped = Math.max(0, Math.min(pos, tr.state.doc.length));
        const anchor = tr.state.doc.lineAt(clamped).to;
        const widget = Decoration.widget({
          widget: new CommentWidget({ thread, orphaned, actions: commentActions }),
          block: true,
          side: 1,
        });
        deco = deco.update({ add: [widget.range(anchor)] });
      } else if (effect.is(removeAiComment)) {
        const id = effect.value;
        deco = deco.update({
          filter: (_from, _to, value) =>
            !(isCommentWidget(value.spec.widget) && value.spec.widget.spec.thread.id === id),
        });
      } else if (effect.is(clearAiComments)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Действия, которыми виджет дотягивается до приложения. Живут в модуле, а не
 * в каждом спеке: виджет пересоздаётся на каждое изменение треда, а колбэки
 * стабильны — иначе `eq()` пришлось бы сравнивать функции.
 */
export const commentActions: CommentActions = {
  reply: () => {},
  resolve: () => {},
  handoff: () => {},
  insertIntoText: () => {},
};

/** Подставить настоящие обработчики при монтировании приложения. */
export function setCommentActions(actions: Partial<CommentActions>): void {
  Object.assign(commentActions, actions);
}
```

- [ ] **Step 4: Прогнать — проходит**

Run: `npx vitest run --dir src src/lib/editor/ai-comment.test.ts`
Expected: PASS.

- [ ] **Step 5: Подключить в setup.ts**

Добавить импорт рядом с существующими (строка 25):

```ts
import { aiCommentField } from './ai-comment';
```

И в массив расширений, сразу после `aiAskField,` (строка 39):

```ts
    aiCommentField,
```

- [ ] **Step 6: Добавить стили**

В конец `src/styles/editor.css`:

```css
/* AI-комментарии — обратное направление AI-интерфейса. Одна визуальная семья
 * с `.cm-ai-ask`, поэтому те же токены `--ai-ask-*`.
 *
 * `.cm-ai-comment-wrap` — корень виджета, и CM6 измеряет его высоту по
 * DOM-боксу, куда margin не входит. Вертикальные отступы поэтому padding
 * здесь, а не margin на `.cm-ai-comment`. */
.cm-ai-comment-wrap {
  padding: 0.4rem 0;
}

.cm-ai-comment {
  border: 1px solid var(--ai-ask-border);
  border-radius: 6px;
  padding: 0.6rem 0.7rem;
  /* Непрозрачный стек, ОБЯЗАТЕЛЬНО оба свойства — ровно как у `.cm-ai-ask`.
   * `--ai-ask-bg` это заливка с альфой 6–10%, а слой drawSelection лежит на
   * z-index -2, то есть позади контента: без сплошного background-color
   * выделение просвечивает сквозь карточку. */
  background-color: var(--bg-base);
  background-image: linear-gradient(var(--ai-ask-bg), var(--ai-ask-bg));
  font-size: 0.9em;
  /* Протяжённое выделение по документу не должно закрашивать карточку. */
  -webkit-user-select: none;
  user-select: none;
}

/* Поле ввода — единственное место в карточке, где выделение текста нужно. */
.cm-ai-comment-input:focus {
  -webkit-user-select: text;
  user-select: text;
}

.cm-ai-comment-orphaned {
  border-style: dashed;
}

.cm-ai-comment-head {
  opacity: 0.7;
  font-size: 0.85em;
  margin-bottom: 0.4rem;
}

.cm-ai-comment-reply {
  margin-bottom: 0.4rem;
}

.cm-ai-comment-author {
  opacity: 0.7;
  font-size: 0.85em;
}

.cm-ai-comment-text {
  white-space: pre-wrap;
}

.cm-ai-comment-input {
  width: 100%;
  margin: 0.3rem 0;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--ai-ask-border);
  border-radius: 4px;
  background: var(--ai-ask-chip-bg);
  color: inherit;
  font: inherit;
}

.cm-ai-comment-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.cm-ai-comment-button {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--ai-ask-border);
  border-radius: 4px;
  background: var(--ai-ask-chip-bg);
  color: inherit;
  font: inherit;
  font-size: 0.9em;
  cursor: pointer;
}

.cm-ai-comment-button:hover {
  background: var(--ai-ask-chip-hover-bg);
}
```

**Перед написанием этого CSS** проверить в `src/lib/theme/light.css` и `dark.css`, что токены `--ai-ask-border`, `--ai-ask-bg`, `--ai-ask-chip-bg`, `--ai-ask-chip-hover-bg` действительно так называются, и что они определены во всех четырёх темах (light, dark, aurora-light, aurora-dark). Если какого-то токена нет — использовать тот, что есть, а не изобретать новый.

- [ ] **Step 7: Проверить типы, прогнать всё, закоммитить**

```bash
npm run check
npx vitest run --dir src
git add src/lib/editor/ai-comment.ts src/lib/editor/ai-comment.test.ts src/lib/editor/setup.ts src/styles/editor.css
git commit -m "feat(editor): comment thread block widget mirroring ai-ask"
```

---

## Task 9: Tauri-команды и обвязка в App.svelte

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (регистрация в invoke handler)
- Modify: `src-tauri/src/watcher.rs` (добавить сайдкар в набор наблюдаемых)
- Modify: `src/lib/tauri/commands.ts`
- Modify: `src/App.svelte`

- [ ] **Step 1: Добавить Tauri-команды**

В `src-tauri/src/commands.rs`, следуя существующему паттерну `#[tauri::command]` с `Result<T, String>`:

```rust
/// Прочитать треды комментариев документа.
#[tauri::command]
pub async fn comment_threads(path: String) -> Result<Vec<crate::comments::Thread>, String> {
    crate::comments::load(std::path::Path::new(&path))
}

/// Создать новый тред: цитата выделенного фрагмента плюс текст человека.
#[tauri::command]
pub async fn comment_create(
    path: String,
    line: usize,
    quote: String,
    text: String,
) -> Result<String, String> {
    let doc = std::path::Path::new(&path);
    let existing: Vec<String> = crate::comments::load(doc)?
        .into_iter()
        .map(|t| t.id)
        .collect();
    let id = crate::comments::new_id_avoiding(doc, crate::comments::now_epoch(), &existing);
    crate::comments::append_thread(doc, &id, line, &quote, "Вы", &text)?;
    Ok(id)
}

/// Дописать реплику человека в тред.
#[tauri::command]
pub async fn comment_reply(path: String, id: String, text: String) -> Result<(), String> {
    crate::comments::append_reply(std::path::Path::new(&path), &id, "Вы", &text)?;
    // Реплика человека возвращает тред в ожидание ответа: `append_reply`
    // выставляет `answered`, что верно для агента и неверно здесь.
    crate::comments::set_status(
        std::path::Path::new(&path),
        &id,
        crate::comments::Status::Open,
    )
}

/// Закрыть тред.
#[tauri::command]
pub async fn comment_resolve(path: String, id: String) -> Result<(), String> {
    crate::comments::set_status(
        std::path::Path::new(&path),
        &id,
        crate::comments::Status::Resolved,
    )
}
```

Зарегистрировать все четыре в `tauri::generate_handler![...]` в `lib.rs`, рядом с `read_file`, `write_file`, `file_exists`.

- [ ] **Step 2: Наблюдать сайдкар — и НЕ переиспользовать путь внешнего изменения**

Файл комментариев правят двое, md-mini и агент, поэтому ответ агента должен появляться в открытом окне сам. Но существующий путь `file-changed-externally` для этого не годится, и это проверено по коду, а не предположено:

- `handleExternalChange` (`src/App.svelte:288-317`) делает ранний выход при `path !== fileState.filePath` — событие про сайдкар до него просто не дойдёт.
- Ветка «файл грязный» открывает блокирующее модальное окно `ask()` из `@tauri-apps/plugin-dialog`. Для сайдкара это неприемлемо: агент пишет ответ, а пользователю прилетает модалка.
- Подавление собственной записи — один глобальный флаг `isSaving` с трейлинг-таймером на 600 мс (`src/App.svelte:139,163,172`), а не per-path.

Поэтому нужен **отдельный, адресный** событие-канал. Watcher уже перезапускается как побочный эффект команды `register_open_file` (см. комментарий в `src/App.svelte:243-245` — отдельного `start_watching` больше нет), так что добавлять сайдкар в набор наблюдаемых надо там же.

Событие эмитить **в конкретное окно**, а не глобально, и слушать через `getCurrentWebviewWindow().listen`, а не через глобальный `listen`. Причина задокументирована в `src/lib/tauri/events.ts:103-115`: у глобального слушателя target равен `Any`, что матчит и адресные emit'ы — тогда событие получат все окна, и не-владельцы начнут наперегонки его обрабатывать.

Добавить в `src/lib/tauri/events.ts` по образцу `onAiCommand`:

```ts
/**
 * Файл комментариев документа изменился на диске. Отдельно от
 * `file-changed-externally`: тот путь ранним выходом отсекает любой путь,
 * кроме самого документа, и в грязном состоянии показывает блокирующую
 * модалку — а сайдкар пишет агент, и спрашивать пользователя тут нечего.
 *
 * Адресное событие, поэтому слушать через текущее окно, а не глобально.
 */
export function onCommentsChanged(handler: (path: string) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<string>('comments-changed', (event) => {
    handler(event.payload);
  });
}
```

Реакция — только перерисовка тредов (`reloadComments()` из шага 4), никогда не перезагрузка документа: сам документ при записи сайдкара не менялся.

- [ ] **Step 3: Добавить обёртки IPC**

В `src/lib/tauri/commands.ts`, по образцу `readFile`:

```ts
export async function commentThreads(path: string): Promise<CommentThread[]> {
  return invoke<CommentThread[]>('comment_threads', { path });
}

export async function commentCreate(
  path: string,
  line: number,
  quote: string,
  text: string
): Promise<string> {
  return invoke<string>('comment_create', { path, line, quote, text });
}

export async function commentReply(path: string, id: string, text: string): Promise<void> {
  return invoke('comment_reply', { path, id, text });
}

export async function commentResolve(path: string, id: string): Promise<void> {
  return invoke('comment_resolve', { path, id });
}
```

Импортировать тип `CommentThread` из `../comment-format`.

- [ ] **Step 4: Загружать и перезагружать треды в App.svelte**

Добавить функцию, вызываемую после открытия файла и по событию внешнего изменения сайдкара:

```ts
  async function reloadComments(): Promise<void> {
    const path = fileState.path;
    if (!path || !editorView) return;
    const threads = await commentThreads(path).catch(() => []);
    const doc = editorView.state.doc.toString();
    const effects: StateEffect<unknown>[] = [clearAiComments.of(null)];
    for (const thread of threads) {
      if (thread.status === 'resolved') continue;
      const { pos, orphaned } = anchorPosition(doc, thread.quote, thread.line);
      effects.push(addAiComment.of({ thread, pos, orphaned }));
    }
    editorView.dispatch({ effects });
  }
```

Подключить настоящие действия виджета при монтировании:

```ts
  setCommentActions({
    reply: (id, text) => {
      const path = fileState.path;
      if (!path) return;
      void commentReply(path, id, text).then(reloadComments);
    },
    resolve: (id) => {
      const path = fileState.path;
      if (!path) return;
      void commentResolve(path, id).then(reloadComments);
    },
    handoff: (id) => {
      const path = fileState.path;
      if (!path) return;
      void navigator.clipboard.writeText(buildHandoffPrompt(path, id));
    },
    insertIntoText: (id, text) => {
      if (!editorView) return;
      const set = editorView.state.field(aiCommentField, false);
      if (!set) return;
      let at: number | null = null;
      set.between(0, editorView.state.doc.length, (from, _to, value) => {
        const widget = value.spec.widget;
        if (widget instanceof CommentWidget && widget.spec.thread.id === id) at = from;
      });
      if (at === null) return;
      editorView.dispatch({ changes: { from: at, insert: `\n${text}\n` } });
    },
  });
```

Зарегистрировать новый слушатель в том же блоке `onMount`, рядом с `onFileChangedExternally` (`src/App.svelte:661-663`):

```ts
    const unlistenComments = onCommentsChanged(() => {
      void reloadComments();
    });
```

и добавить `unlistenComments` в тот же список отписок, что и остальные `unlisten*` в этом блоке. Обработчик `handleExternalChange` не трогать вовсе — сайдкар через него не ходит.

**Замечание про имя поля:** в `App.svelte` путь текущего файла называется `fileState.filePath`, а не `fileState.path` — псевдокод выше в шаге 4 использовал короткое имя, при реализации взять настоящее.

- [ ] **Step 5: Проверить и закоммитить**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run check
npx vitest run --dir src
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/watcher.rs src/lib/tauri/commands.ts src/App.svelte
git commit -m "feat(comments): load, reload and mutate threads from the app"
```

---

## Task 10: Создание комментария — клавиша и пункт меню

**Files:**
- Modify: `src-tauri/src/menu.rs`
- Modify: `src/App.svelte`
- Modify: `src/lib/editor/keybindings.ts`

- [ ] **Step 1: Добавить пункт меню**

В `src-tauri/src/menu.rs`, в подменю AI, добавить пункт с id `ai_comment` и текстом «Прокомментировать выделенное», следуя тому, как сделаны существующие пункты меню AI. Пункт обязателен: у фичи должен быть постоянный дом, а не только горячая клавиша, которую забудут.

Проброс события — тем же путём, что и остальные пункты меню (`MenuAction` во фронтенде).

- [ ] **Step 2: Обработать действие**

В `App.svelte`, в обработчике действий меню, добавить ветку:

```ts
      case 'ai_comment':
        void createCommentFromSelection();
        break;
```

И саму функцию:

```ts
  /** Создать тред из текущего выделения (или из строки под каретой). */
  async function createCommentFromSelection(): Promise<void> {
    const path = fileState.path;
    if (!path || !editorView) return;
    const { state } = editorView;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.from);
    // Цитата — выделенный текст; без выделения берём строку целиком, чтобы
    // якорь был содержательным, а не пустым.
    const quote = range.empty ? line.text.trim() : state.sliceDoc(range.from, range.to).trim();
    if (!quote) return;
    const text = window.prompt('Комментарий для агента:');
    if (!text || !text.trim()) return;
    await commentCreate(path, line.number, quote, text.trim());
    await reloadComments();
  }
```

**Примечание для реализующего:** `window.prompt` — сознательно простейший ввод для первой версии, чтобы не тащить модальное окно в этот же таск. Если в проекте уже есть свой примитив ввода (проверить `src/lib/` на наличие модалок или тостов с вводом) — использовать его вместо `prompt`.

- [ ] **Step 3: Добавить клавишу**

В `src/lib/editor/keybindings.ts`, по образцу существующих Cmd+B/I/X, добавить `Mod-Alt-m` → вызов того же действия. Проверить, что комбинация не занята: `grep -n "Mod-" src/lib/editor/keybindings.ts`.

- [ ] **Step 4: Проверить руками**

```bash
npm run dev:app
```

Открыть файл, выделить абзац, нажать пункт меню — убедиться, что: появился блок под строкой; в каталоге рядом с документом возник `.mdmini_comments_<имя>.md`; сам документ не изменился; `git status` показывает только новый файл комментариев.

- [ ] **Step 5: Коммит**

```bash
git add src-tauri/src/menu.rs src/App.svelte src/lib/editor/keybindings.ts
git commit -m "feat(comments): create a thread from the selection via menu and keybinding"
```

---

## Task 11: Документация и сниппеты для агентов

**Files:**
- Modify: `docs/ai-interface.md`
- Modify: `src-tauri/src/ai_socket.rs` (`help_text`, `agent_text`, `mcp_agent_text`)

- [ ] **Step 1: Проверить контракт хуков, а не угадывать его**

Перед написанием сниппета `Stop`-хука выяснить актуальный контракт: как хук блокирует завершение хода и как текст доезжает до модели (код выхода против JSON-решения). Источник — документация Claude Code, а не память. Если контракт подтвердить не удалось — написать сниппет с явной пометкой «проверить перед использованием» и не утверждать его работоспособность.

- [ ] **Step 2: Дописать docs/ai-interface.md**

Добавить в таблицу CLI-верб три строки (`question`, `answer`, `watch`) и отдельный раздел «Обратное направление: комментарии». Раздел обязан содержать:

- Формат файла `.mdmini_comments_<doc>.md` целиком, с примером.
- Что вербы локальные и офлайновые — сокет не нужен, приложение может быть закрыто.
- Настройку Monitor с `persistent: true` и объяснение, почему без флага монитор умрёт через пять минут.
- Что `Stop`-хук — обязательный второй слой, потому что болтливый монитор харнесс останавливает сам, и агент об этом не узнаёт.
- Дисциплину прерывания: довести текущий шаг до консистентного состояния, ответить на чекпойнте.
- Tier-2 путь: кнопка «отправить в агента», и что агент без MCP отвечает обычными Read/Edit.
- Что `.gitignore` md-mini не трогает, и обе стратегии (игнорировать `.mdmini_comments_*` либо коммитить осознанно) легитимны.

- [ ] **Step 3: Обновить help_text**

Добавить три верба в вывод `mdmini help` — он документирует полный набор верб и обязан остаться полным.

- [ ] **Step 4: Обновить agent_text и mcp_agent_text**

В оба сниппета добавить абзац про обратное направление. Ключевое требование к формулировке: инструкция должна быть **условием на наблюдаемые данные и событийным триггером**, а не таймером — «периодически проверяй» агенты не соблюдают. Например:

```markdown
## Комментарии от человека (обратное направление)

- В начале сессии повесь монитор: `Monitor({command: "mdmini watch", description: "новые комменты в mdmini", persistent: true})`. Без `persistent: true` он умрёт через пять минут.
- Строка от монитора — это прерывание, а не сообщение пользователя. Доведи текущий шаг до консистентного состояния, потом ответь: `mdmini question` покажет треды, `mdmini answer <file> --id <id>` отправит ответ (текст на stdin).
- Проверь `mdmini question` также перед тем, как спросить человека в чате, и перед тем, как отчитаться о завершении: возможно, он уже написал ответ в документе.
- Если комментарий просит правку — примени её через `mdmini edit`, затем закрой тред ответом.
- Комментарии живут в `.mdmini_comments_<doc>.md` рядом с документом. Нет MCP — читай и дописывай файл обычными файловыми инструментами, формат человекочитаемый.
```

**Оба сниппета — константы в Rust, и в `docs/ai-interface.md` они продублированы фенсед-блоками.** Держать их синхронными: файл прямо этого требует.

- [ ] **Step 5: Проверить, что вывод верб не разъехался с докой**

```bash
cargo run --manifest-path src-tauri/Cargo.toml -- ai help
cargo run --manifest-path src-tauri/Cargo.toml -- ai agent
cargo run --manifest-path src-tauri/Cargo.toml -- ai agent --mcp
```

Expected: вывод содержит три новых верба и совпадает с фенсед-блоками в `docs/ai-interface.md`.

- [ ] **Step 6: Коммит**

```bash
git add docs/ai-interface.md src-tauri/src/ai_socket.rs
git commit -m "docs(ai): document comments, Monitor setup and the Stop hook backstop"
```

---

## Task 12: Сквозная проверка

**Files:** нет новых

- [ ] **Step 1: Полный прогон**

```bash
npx vitest run --dir src
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run check
npm run check:x86
```

Expected: всё зелёное. `npx vitest run --dir src` — именно так, и запускать из корня worktree: обычный `npm run test` это `vitest` в watch-режиме без конфига тестов, он подхватывает устаревшие копии из `.claude/worktrees/` и завышает счёт.

**Базовая линия — 531 теста в 27 файлах** (измерено в этом worktree перед началом работы). В CLAUDE.md записано 513 — цифра устарела, ориентироваться на 531. К концу плана должно стать 531 плюс новые тесты задач 7 и 8.

- [ ] **Step 2: Проверить путь Monitor целиком**

В отдельном каталоге: запустить `mdmini watch .`, создать комментарий через приложение, убедиться, что напечаталась ровно одна строка; ответить через `mdmini answer`, убедиться, что новых строк нет и ответ появился в открытом окне без ручного обновления; дописать реплику человеком и убедиться, что событие пришло снова.

- [ ] **Step 3: Проверить, что документ остался чистым**

`git status` в тестовом репозитории показывает только `.mdmini_comments_*.md`, сам документ не изменён ни на байт.

- [ ] **Step 4: Финальный коммит и пуш**

```bash
git add -A
git commit -m "test: verify the comment flow end to end"
git push
```

---

## Self-review плана против спеки

Пройдено по разделам спеки:

| Требование спеки | Задача |
|---|---|
| Формат файла, статусы, якорь цитатой | 1, 2, 7 |
| Точечная правка вместо полного re-render | 3 |
| Атомарная запись, два писателя | 3, 9 |
| Запрет комментировать файл комментариев | 1, 3 |
| Вербы `question`/`answer` локальные, офлайновые | 4 |
| `mdmini watch` без сокета, дерево каталогов | 5 |
| Флуд-контроль, никогда не переэмитить | 5 |
| Повторный `open` после реплики человека — снова событие | 5, 9 |
| MCP-паритет | 6 |
| Виджет треда, капкан height-map | 8 |
| Реакция на внешнее изменение сайдкара | 9 |
| Создание из выделения, пункт меню | 10 |
| `persistent: true`, Stop-хук, дисциплина прерывания | 11 |
| Tier 2 — кнопка с промптом | 7 (текст), 8 (кнопка), 11 (дока) |
| `.gitignore` не трогаем | 11 |
| Worktrees — фрагментация как правильное поведение | следует из хранения рядом с документом, отдельной задачи не требует |

**Отложено сознательно, отмечено в спеке как вне v1:** веер по нескольким агентам, панель-инбокс по всем файлам, Antigravity SDK Triggers, long-polling `question`.

**Единственный непроверенный факт в плане** — контракт `Stop`-хука; задача 11 шаг 1 требует его выяснить, а не предполагать.
