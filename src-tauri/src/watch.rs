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
                // Атомарная запись в comments.rs — это write в `.tmp`, затем
                // `rename` на итоговое имя. Событие Create/Modify/Remove на
                // самом `.tmp` пути не несёт готового контента (и появляется
                // до rename), а событие для итогового пути приходит уже после
                // rename — поэтому фильтруем по итоговому пути через
                // `is_sidecar`, которое ни один `.tmp`-путь не проходит: у
                // него другое расширение, не имя вида `.mdmini_comments_*`.
                let touched_sidecar = event.paths.iter().any(|p| crate::comments::is_sidecar(p));
                if touched_sidecar {
                    // Небольшая задержка: rename на некоторых ФС дробится на
                    // отдельные события, и без паузы можно прочитать файл в
                    // промежутке.
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
