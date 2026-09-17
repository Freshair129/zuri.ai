// @req ZAI:FR-150, ZAI:FR-171 — bounded local execution telemetry survives Desktop reconnect/restart.
// @spec ZAI:ADR-090, SEC-025 — only allowlisted events; no transcript or credentials.
// @tested durable_log::tests
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
};

const CAPACITY: usize = 200;
const MAX_BYTES: u64 = 1024 * 1024;
const RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;

struct State {
    epoch: String,
    next: u64,
    entries: VecDeque<Value>,
    persisted: u64,
    error: bool,
    reset: bool,
}

#[derive(Clone)]
pub struct DurableLog {
    state: Arc<Mutex<State>>,
    notify: Option<mpsc::SyncSender<()>>,
}

fn project(event: &Value) -> Option<Value> {
    if event["type"] == "notice" {
        let level = event["level"].as_str()?;
        return matches!(level, "info" | "warn" | "error")
            .then(|| json!({"type":"notice","level":level}));
    }
    let safe = crate::supervisor::safe_event(event)?;
    if safe["type"] == "heartbeat" || (safe["type"] == "claim" && safe["outcome"] == "idle") {
        return None;
    }
    Some(safe)
}

fn prune(state: &mut State) {
    let cutoff = chrono::Utc::now().timestamp() - RETENTION_SECONDS;
    while state.entries.front().is_some_and(|e| {
        e["at"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_none_or(|at| at.timestamp() < cutoff)
    }) {
        state.entries.pop_front();
    }
    while state.entries.len() > CAPACITY {
        state.entries.pop_front();
    }
}

fn load(path: &Path, state: &mut State) -> Result<(), ()> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if value["schemaVersion"] != 1 {
        return Err(());
    }
    let entries = value["entries"].as_array().ok_or(())?;
    if entries.len() > CAPACITY {
        return Err(());
    }
    let mut previous = 0;
    for entry in entries {
        let seq = entry["sequence"]
            .as_u64()
            .filter(|n| *n > previous && *n < u64::MAX)
            .ok_or(())?;
        let id = entry["id"].as_str().ok_or(())?;
        let (epoch, suffix) = id.rsplit_once(':').ok_or(())?;
        if uuid::Uuid::parse_str(epoch).is_err() || suffix.parse::<u64>().ok() != Some(seq) {
            return Err(());
        }
        let at = entry["at"].as_str().ok_or(())?;
        chrono::DateTime::parse_from_rfc3339(at).map_err(|_| ())?;
        let event = project(&entry["event"]).ok_or(())?;
        state
            .entries
            .push_back(json!({"id":id,"sequence":seq,"at":at,"event":event}));
        previous = seq;
    }
    state.next = previous + 1;
    state.persisted = previous;
    prune(state);
    Ok(())
}

fn persist(path: &Path, entries: &VecDeque<Value>) -> Result<(), ()> {
    let parent = path.parent().ok_or(())?;
    fs::create_dir_all(parent).map_err(|_| ())?;
    let bytes =
        serde_json::to_vec(&json!({"schemaVersion":1,"entries":entries})).map_err(|_| ())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(());
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| ())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| ())?;
    temp.persist(path).map_err(|_| ())?;
    Ok(())
}

impl DurableLog {
    pub fn open(path: Option<PathBuf>) -> Self {
        let mut state = State {
            epoch: uuid::Uuid::new_v4().to_string(),
            next: 1,
            entries: VecDeque::new(),
            persisted: 0,
            error: path.is_none(),
            reset: false,
        };
        if path.as_ref().is_some_and(|p| load(p, &mut state).is_err()) {
            state.entries.clear();
            state.next = 1;
            state.persisted = 0;
            state.reset = true;
        }
        let state = Arc::new(Mutex::new(state));
        let notify = path.and_then(|path| {
            let (tx, rx) = mpsc::sync_channel(1);
            let weak = Arc::downgrade(&state);
            match std::thread::Builder::new()
                .name("edge-console-persist".into())
                .spawn(move || {
                    while rx.recv().is_ok() {
                        let Some(shared) = weak.upgrade() else {
                            break;
                        };
                        let (entries, through) = {
                            let mut s = shared.lock().unwrap();
                            prune(&mut s);
                            (s.entries.clone(), s.next - 1)
                        };
                        let result = persist(&path, &entries);
                        let mut s = shared.lock().unwrap();
                        s.error = result.is_err();
                        if result.is_ok() {
                            s.persisted = through;
                        }
                    }
                }) {
                Ok(_) => Some(tx),
                Err(_) => {
                    state.lock().unwrap().error = true;
                    None
                }
            }
        });
        if let Some(tx) = &notify {
            let _ = tx.try_send(());
        }
        Self { state, notify }
    }

    // Only memory work and a nonblocking notification occur on the worker event path.
    pub fn record(&self, event: &Value) {
        let Some(event) = project(event) else {
            return;
        };
        let mut s = self.state.lock().unwrap();
        let sequence = s.next;
        let id = format!("{}:{sequence}", s.epoch);
        s.next += 1;
        s.entries.push_back(json!({"id":id,"sequence":sequence,"at":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs,true),"event":event}));
        prune(&mut s);
        drop(s);
        if let Some(tx) = &self.notify {
            let _ = tx.try_send(());
        }
    }

    pub fn page(&self, cursor: Option<&str>) -> Value {
        let mut s = self.state.lock().unwrap();
        let previous_len = s.entries.len();
        prune(&mut s);
        if previous_len != s.entries.len() {
            if let Some(tx) = &self.notify {
                let _ = tx.try_send(());
            }
        }
        let newest = s.next - 1;
        let oldest = s
            .entries
            .front()
            .and_then(|e| e["sequence"].as_u64())
            .unwrap_or(s.next);
        let parsed = cursor
            .and_then(|c| c.rsplit_once(':'))
            .and_then(|(epoch, seq)| seq.parse::<u64>().ok().map(|n| (epoch, n)));
        let gap = if cursor.is_some() {
            match parsed {
                None => Some("INVALID_CURSOR"),
                Some((epoch, _)) if epoch != s.epoch => Some("PROCESS_RESTART_OR_RESET"),
                Some((_, n)) if n > newest || n.saturating_add(1) < oldest => Some("RETENTION_GAP"),
                _ => None,
            }
        } else if s.reset {
            Some("STORAGE_RESET")
        } else {
            None
        };
        let after = if gap.is_some() {
            0
        } else {
            parsed.map_or(0, |(_, n)| n)
        };
        let entries: Vec<Value> = s
            .entries
            .iter()
            .filter(|e| e["sequence"].as_u64().unwrap_or(0) > after)
            .map(|e| {
                let event = &e["event"];
                let kind = event["type"].as_str().unwrap_or("unknown");
                let level =
                    if kind == "failure" || (kind == "progress" && event["state"] == "FAILED") {
                        "error"
                    } else if event["level"] == "warn" || event["level"] == "error" {
                        event["level"].as_str().unwrap()
                    } else {
                        "info"
                    };
                let message = match kind {
                    "progress" => format!(
                        "{} {} · {} · {} · {}ms · งาน {} · execution {} · เหลือ {}",
                        event["phase"].as_str().unwrap_or("-"),
                        event["state"].as_str().unwrap_or("-"),
                        event["modelRef"].as_str().unwrap_or("-"),
                        event["toolName"].as_str().unwrap_or("-"),
                        event["durationMs"].as_u64().unwrap_or(0),
                        event["jobId"].as_str().unwrap_or("-"),
                        event["executionId"].as_str().unwrap_or("-"),
                        event["remainingBudgetMs"]
                            .as_u64()
                            .map(|n| format!("{n}ms"))
                            .unwrap_or_else(|| "-".into())
                    ),
                    "claim" => format!(
                        "งาน: {} · {} · execution {} · {} · เหลือ {}",
                        event["outcome"].as_str().unwrap_or("unknown"),
                        event["jobId"].as_str().unwrap_or("-"),
                        event["executionId"].as_str().unwrap_or("-"),
                        event["deliveryMode"].as_str().unwrap_or("LEGACY"),
                        event["remainingBudgetMs"]
                            .as_u64()
                            .map(|n| format!("{n}ms"))
                            .unwrap_or_else(|| "-".into())
                    ),
                    "ready" => "ตัวประมวลผลพร้อมรับงาน".into(),
                    "failure" => format!(
                        "ตัวประมวลผลหยุดด้วยข้อผิดพลาด: {}",
                        event["code"].as_str().unwrap_or("WORKER_FAILED")
                    ),
                    "stopping" => "กำลังหยุดตัวประมวลผล".into(),
                    "stopped" => "ตัวประมวลผลหยุดแล้ว".into(),
                    _ => "การเริ่มรับงานอัตโนมัติมีการเปลี่ยนสถานะ โปรดตรวจสถานะตัวประมวลผล".into(),
                };
                json!({"id":e["id"],"at":e["at"],"level":level,"message":message})
            })
            .collect();
        json!({"entries":entries,"cursor":format!("{}:{newest}",s.epoch),"gap":gap,"storage":if s.error {"UNAVAILABLE"} else if s.persisted < newest {"PENDING"} else {"DURABLE"},"persistedThrough":s.persisted,"capacity":CAPACITY,"retentionDays":7})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> Value {
        json!({"type":"ready","version":1,"rawText":"private conversation","deviceKey":"edgk_secret"})
    }
    fn wait_saved(log: &DurableLog) {
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while log.page(None)["storage"] != "DURABLE" {
            assert!(
                std::time::Instant::now() < until,
                "persistence did not complete"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[test]
    fn saves_safe_events_and_preserves_ids_across_restart_with_explicit_cursor_gap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.json");
        let log = DurableLog::open(Some(path.clone()));
        log.record(&ready());
        wait_saved(&log);
        let page = log.page(None);
        let cursor = page["cursor"].as_str().unwrap();
        assert_eq!(
            log.page(Some(cursor))["entries"].as_array().unwrap().len(),
            0
        );
        let stored = fs::read_to_string(&path).unwrap();
        assert!(!stored.contains("private conversation") && !stored.contains("edgk_secret"));
        let reopened = DurableLog::open(Some(path));
        let resumed = reopened.page(Some(cursor));
        assert_eq!(resumed["gap"], "PROCESS_RESTART_OR_RESET");
        assert_eq!(resumed["entries"][0]["id"], page["entries"][0]["id"]);
    }
    #[test]
    fn retention_and_capacity_report_missing_sequence_instead_of_success() {
        let log = DurableLog::open(None);
        log.record(&ready());
        let old = log.page(None)["cursor"].as_str().unwrap().to_owned();
        for _ in 0..CAPACITY + 1 {
            log.record(&ready());
        }
        let page = log.page(Some(&old));
        assert_eq!(page["gap"], "RETENTION_GAP");
        assert_eq!(page["entries"].as_array().unwrap().len(), CAPACITY);
        assert_eq!(page["storage"], "UNAVAILABLE");
        let mut state = log.state.lock().unwrap();
        for entry in &mut state.entries {
            entry["at"] = json!("2000-01-01T00:00:00Z");
        }
        drop(state);
        assert!(log.page(None)["entries"].as_array().unwrap().is_empty());
    }
    #[test]
    fn rejects_unknown_events_and_drops_free_text_notes_and_heartbeat_fields() {
        let log = DurableLog::open(None);
        log.record(&json!({"type":"heartbeat","version":1,"ok":true,"at":"secret"}));
        log.record(&json!({"type":"anything","message":"secret"}));
        log.record(&json!({"type":"notice","level":"warn","message":"secret"}));
        log.record(&json!({"type":"claim","version":1,"outcome":"failed","jobId":"secret","executionId":"00000000-0000-0000-0000-000000000001","remainingBudgetMs":999999}));
        let page = log.page(None);
        assert_eq!(page["entries"].as_array().unwrap().len(), 2);
        assert!(!page.to_string().contains("secret"));
        assert!(page.to_string().contains("failed"));
        assert!(!page.to_string().contains("เหลือ 0ms"));
    }
    #[test]
    fn corrupt_or_oversized_storage_resets_epoch_and_reports_gap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.json");
        fs::write(&path, b"{broken").unwrap();
        let log = DurableLog::open(Some(path));
        assert_eq!(log.page(None)["gap"], "STORAGE_RESET");
        assert_eq!(log.page(Some("invalid"))["gap"], "INVALID_CURSOR");
        let oversized = dir.path().join("oversized.json");
        fs::write(&oversized, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(
            DurableLog::open(Some(oversized)).page(None)["gap"],
            "STORAGE_RESET"
        );
    }
    #[test]
    fn persistence_failure_remains_visible_without_losing_memory_events() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-directory");
        fs::write(&blocker, b"synthetic blocker").unwrap();
        let log = DurableLog::open(Some(blocker.join("log.json")));
        log.record(&ready());
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while log.page(None)["storage"] != "UNAVAILABLE" {
            assert!(std::time::Instant::now() < until);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(log.page(None)["entries"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn native_progress_projection_keeps_only_known_phases_tools_and_trace_refs() {
        let log = DurableLog::open(None);
        let event = json!({"version":1,"type":"progress","phase":"TOOL","state":"FAILED","toolName":"quote_price",
            "modelRef":"qwen3.5:9b","jobId":"10000000-0000-0000-0000-000000000001","executionId":"20000000-0000-0000-0000-000000000001",
            "elapsedMs":125,"durationMs":25,"remainingBudgetMs":30000,"prompt":"secret","args":{"secret":true},"output":"private"});
        log.record(&event);
        let mut invalid = event.clone();
        invalid["toolName"] = json!("arbitrary_shell");
        log.record(&invalid);
        invalid = event.clone();
        invalid["durationMs"] = json!(900000);
        log.record(&invalid);
        let page = log.page(None);
        assert_eq!(page["entries"].as_array().unwrap().len(), 1);
        let text = page.to_string();
        assert!(
            text.contains("quote_price") && text.contains("qwen3.5:9b") && text.contains("25ms")
        );
        assert!(
            !text.contains("secret")
                && !text.contains("private")
                && !text.contains("arbitrary_shell")
        );
        let stored = log.state.lock().unwrap().entries[0].to_string();
        assert!(
            !stored.contains("prompt") && !stored.contains("args") && !stored.contains("output")
        );
    }
}
