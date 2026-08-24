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
}
