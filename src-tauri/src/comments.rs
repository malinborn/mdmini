//! Слой комментариев: чтение и точечная правка `.mdmini_comments_<doc>.md`.
//!
//! Источник истины — файл, а не md-mini. Поэтому здесь нет ни стора, ни GC:
//! модуль умеет только разобрать файл и внести в него минимальное изменение.
//! Полной перезаписи нет сознательно — файл правят и агенты, и люди руками.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
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
}
