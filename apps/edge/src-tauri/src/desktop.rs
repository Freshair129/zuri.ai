// @spec FR-150, FR-144, SEC-025 — coordinate provider settings, pairing and the owned worker.
use crate::{
    commands::{get_config_path, persist_config, AppState},
    providers::{self, ProviderSettings},
    supervisor::ManagedWorkerConfig,
};
use serde_json::Value;
use tauri::State;

pub fn data_root() -> Result<std::path::PathBuf, String> {
    get_config_path()?
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "ไม่พบโฟลเดอร์ข้อมูล Desktop".into())
}
async fn stopped(state: &AppState) -> Result<(), String> {
    if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("กำลังปิดแอป".into());
    }
    if state.supervisor.is_active() {
        return Err("กรุณาหยุดรับงานก่อนเปลี่ยนการตั้งค่าหรือบัญชี".into());
    }
    if state.pairing.lock().await.is_some() {
        return Err("กรุณาจับคู่ให้เสร็จก่อนเปลี่ยนการตั้งค่าหรือบัญชี".into());
    }
    Ok(())
}
#[tauri::command]
pub fn get_provider_settings(state: State<'_, AppState>) -> ProviderSettings {
    state.config.lock().unwrap().provider_settings.clone()
}
#[tauri::command]
pub async fn save_provider_settings(
    mut settings: ProviderSettings,
    state: State<'_, AppState>,
) -> Result<ProviderSettings, String> {
    let _guard = state.lifecycle.lock().await;
    stopped(&state).await?;
    providers::validate_settings(&settings)?;
    settings.ollama_base_url = providers::validate_ollama_base_url(&settings.ollama_base_url)?;
    let mut cfg = state.config.lock().unwrap().clone();
    cfg.provider_settings = settings.clone();
    persist_config(&cfg)?;
    *state.config.lock().unwrap() = cfg;
    Ok(settings)
}
#[tauri::command]
pub async fn discover_ollama(base_url: String) -> Result<Value, String> {
    providers::discover_ollama(&base_url).await
}
#[tauri::command]
pub async fn get_provider_status(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state.providers.status(&provider, &data_root()?).await
}
#[tauri::command]
pub async fn start_provider_login(
    provider: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    stopped(&state).await?;
    state
        .providers
        .start_login(&provider, &data_root()?, app)
        .await
}
#[tauri::command]
pub async fn cancel_provider_login(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    stopped(&state).await?;
    state.providers.cancel_login(&provider).await
}
#[tauri::command]
pub fn get_worker_status(state: State<'_, AppState>) -> Value {
    worker_status(&state)
}

/// The operator-readable activity log, oldest first.
///
/// Until now the only window into what the device was doing was the single-line status, so a
/// device that answered nothing looked the same as a device with nothing to answer. Entries come
/// from the bounded event vocabulary the worker already reports plus the app's own lifecycle
/// notes; no message content, device key or provider credential passes through here.
#[tauri::command]
pub fn get_worker_log(state: State<'_, AppState>) -> Value {
    serde_json::json!({ "entries": state.supervisor.log() })
}

/// The supervisor's own snapshot, plus the reason an automatic resume gave up.
///
/// A resume that fails before the child is spawned — Ollama not up yet at logon, the chosen model
/// gone, a provider logged out — leaves the supervisor STOPPED, which is indistinguishable from
/// "nobody pressed Start". Reporting it as FAILED with the message puts it in the panel the UI
/// already renders for a failed worker, and FAILED is one of the two states Start stays enabled
/// for, so the operator reads the reason and retries without needing a new control.
pub fn worker_status(state: &AppState) -> Value {
    let mut snapshot = state.supervisor.snapshot();
    let error = state
        .autostart_error
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    if let (Some(error), Some(object)) = (error, snapshot.as_object_mut()) {
        if object.get("active") == Some(&Value::Bool(false)) {
            object.insert("state".into(), Value::String("FAILED".into()));
            object.insert("failure".into(), Value::String(error));
            object.insert("autoResume".into(), Value::Bool(true));
        }
    }
    snapshot
}

#[tauri::command]
pub async fn start_worker(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    let snapshot = start_worker_locked(&state).await?;
    remember_worker_intent(&state, true);
    Ok(snapshot)
}

/// Start the worker. The caller must already hold the lifecycle lock.
async fn start_worker_locked(state: &AppState) -> Result<Value, String> {
    if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("กำลังปิดแอป".into());
    }
    if state.supervisor.is_active() {
        return Ok(state.supervisor.snapshot());
    }
    if state.pairing.lock().await.is_some() {
        return Err("กรุณาจับคู่ให้เสร็จก่อนเริ่มรับงาน".into());
    }
    let cfg = state.config.lock().unwrap().clone();
    if cfg.device_key.is_empty() {
        return Err("กรุณาเชื่อมต่อ Zuri ก่อน".into());
    }
    providers::validate_settings(&cfg.provider_settings)?;
    let settings = &cfg.provider_settings;
    let root = data_root()?;
    let local = settings.provider == "ollama";
    if local {
        let result = providers::discover_ollama(&settings.ollama_base_url).await?;
        let found = result["models"].as_array().is_some_and(|models| {
            models.iter().any(|item| {
                item["name"].as_str().or_else(|| item.as_str())
                    == Some(settings.ollama_model.as_str())
            })
        });
        if !found {
            return Err("ไม่พบโมเดลที่เลือกใน Ollama กรุณาค้นหาและเลือกใหม่".into());
        }
    } else {
        if !settings.allow_cloud {
            return Err("กรุณาเปิดสิทธิ์ใช้ผู้ให้บริการภายนอกก่อนเริ่มงาน".into());
        }
        let status = state.providers.status(&settings.provider, &root).await?;
        if status["state"] != "READY" {
            return Err("กรุณา Login และตรวจบัญชีตัวช่วยที่เลือกก่อน".into());
        }
    }
    let exe = std::env::current_exe().map_err(|_| "ไม่พบแพ็กเกจ Desktop")?;
    let package_root = exe.parent().ok_or("ไม่พบแพ็กเกจ Desktop")?.to_path_buf();
    let provider = crate::supervisor::ManagedProviderSettings {
        llm_enabled: local,
        llm_allow_cloud: !local && settings.allow_cloud,
        llm_base_url: if local {
            Some(format!(
                "{}/v1",
                providers::validate_ollama_base_url(&settings.ollama_base_url)?
            ))
        } else {
            None
        },
        llm_model: if local {
            Some(settings.ollama_model.clone())
        } else {
            None
        },
        llm_num_ctx: Some(8192),
        llm_effort: Some("low".into()),
        headless_enabled: !local,
        headless_bin: if local {
            None
        } else {
            Some(settings.provider.clone())
        },
        headless_model: match settings.provider.as_str() {
            "codex" => Some(settings.codex_model.clone()),
            "claude" => Some(settings.claude_model.clone()),
            _ => None,
        },
        headless_max_turns: Some(8),
        headless_timeout_ms: Some(120000),
    };
    state
        .supervisor
        .start(ManagedWorkerConfig {
            device_id: cfg.device_id,
            cloud_base_url: cfg.cloud_base_url,
            device_key: cfg.device_key,
            node_path: package_root.join("runtime/node.exe"),
            worker_entry: package_root.join("worker/dist/desktop-worker.js"),
            package_root,
            data_root: root.join("runtime-data"),
            managed_provider_home: if local {
                None
            } else {
                Some(providers::provider_home(&root, &settings.provider)?)
            },
            rag_url: Some("http://127.0.0.1:8888".into()),
            poll_interval_ms: 5000,
            heartbeat_interval_ms: 40000,
            provider,
        })
        .await
}
#[tauri::command]
pub async fn stop_worker(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    // Pressing Stop is the operator saying "not until I say so" — it must survive a restart, or
    // the next logon would undo the decision. Closing the window also stops the child, but that
    // path never reaches here, so it stays a "still wanted" shutdown.
    remember_worker_intent(&state, false);
    *state.autostart_error.lock().unwrap() = None;
    state.supervisor.stop().await
}

/// Record the operator's intent for the worker so the next launch can honour it.
///
/// A failure to persist is deliberately not fatal: the worker in front of the operator did start
/// (or stop) as asked, and refusing that because a config write failed would be a worse trade. The
/// cost is bounded and self-correcting — the next successful Start or Stop rewrites the file.
fn remember_worker_intent(state: &AppState, wanted: bool) {
    let cfg = {
        let mut cfg = state.config.lock().unwrap();
        if cfg.worker_autostart == wanted {
            return;
        }
        cfg.worker_autostart = wanted;
        cfg.clone()
    };
    let _ = persist_config(&cfg);
}

/// How long a logon resume keeps waiting for the local dependencies to answer.
///
/// At logon everything starts at once: Ollama from its own shortcut, the embed sidecar and RAG
/// service from the ZuriEdgeStack task, and this app from the Startup folder. A single attempt
/// loses that race almost every time — `start_worker_locked` asks Ollama for the model list and
/// gives up if it is not answering yet. These bounds mirror the launcher's own waits rather than
/// retrying forever, so a genuinely broken configuration still surfaces as an error the operator
/// can read instead of a spinner that never resolves.
const RESUME_ATTEMPTS: usize = 12;
const RESUME_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

/// Start the worker again at launch if that was the operator's last explicit intent.
///
/// Not a command: nothing in the UI calls this, and it must run when no window has been touched.
pub async fn resume_worker(state: &AppState) {
    {
        let cfg = state.config.lock().unwrap();
        if !cfg.worker_autostart || cfg.device_key.is_empty() {
            return;
        }
    }
    state
        .supervisor
        .note("info", "เริ่มรับงานอัตโนมัติตามที่ตั้งไว้ครั้งล่าสุด");
    for attempt in 1..=RESUME_ATTEMPTS {
        if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let outcome = {
            let _guard = state.lifecycle.lock().await;
            start_worker_locked(state).await
        };
        match outcome {
            Ok(_) => {
                *state.autostart_error.lock().unwrap() = None;
                return;
            }
            Err(error) => {
                // Keep the latest reason visible while retrying, so a window opened during the
                // wait shows what is being waited on rather than a bare stopped worker.
                *state.autostart_error.lock().unwrap() = Some(error.clone());
                if attempt == RESUME_ATTEMPTS {
                    state.supervisor.note(
                        "error",
                        format!("เริ่มอัตโนมัติไม่สำเร็จ หยุดลองแล้ว: {error}"),
                    );
                    return;
                }
                state.supervisor.note(
                    "warn",
                    format!(
                        "เริ่มอัตโนมัติไม่สำเร็จ (ครั้งที่ {attempt}/{RESUME_ATTEMPTS}) จะลองใหม่: {error}"
                    ),
                );
                tokio::time::sleep(RESUME_INTERVAL).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::{AppState, EdgePairingConfig},
        pairing::{Pending, Started},
        providers::ProviderManager,
        supervisor::Supervisor,
    };
    use std::sync::{atomic::AtomicBool, Mutex};

    fn test_state() -> AppState {
        AppState {
            config: Mutex::new(EdgePairingConfig::default()),
            load_error: Mutex::new(None),
            verified: AtomicBool::new(false),
            pairing: tokio::sync::Mutex::new(None),
            lifecycle: tokio::sync::Mutex::new(()),
            supervisor: Supervisor::default(),
            providers: ProviderManager::default(),
            quitting: AtomicBool::new(false),
            autostart_error: Mutex::new(None),
        }
    }

    fn pending_pairing() -> Pending {
        Pending {
            start: Started {
                request_id: "request".into(),
                device_secret: "secret".into(),
                approval_url: "https://cloud.example/edge/pair".into(),
                check_code: "ABC-123".into(),
                expires_at: "2099-01-01T00:00:00Z".into(),
            },
            origin: "https://cloud.example".into(),
            received: None,
        }
    }

    #[tokio::test]
    async fn provider_mutations_reject_pending_pairing() {
        let state = test_state();
        *state.pairing.lock().await = Some(pending_pairing());

        let error = stopped(&state)
            .await
            .expect_err("pairing should lock mutations");

        assert_eq!(error, "กรุณาจับคู่ให้เสร็จก่อนเปลี่ยนการตั้งค่าหรือบัญชี");
    }

    #[tokio::test]
    async fn provider_mutations_reject_during_quit() {
        let state = test_state();
        state
            .quitting
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let error = stopped(&state)
            .await
            .expect_err("quit should lock mutations");

        assert_eq!(error, "กำลังปิดแอป");
    }

    // The resume runs with no window open and no operator watching, so each guard below is the
    // difference between "does nothing, correctly" and "retries a doomed start for three minutes".

    #[tokio::test]
    async fn resume_does_nothing_when_the_operator_stopped_the_worker() {
        let state = test_state();
        state.config.lock().unwrap().device_key = "edgk_test_key_that_is_long_enough".into();
        state.config.lock().unwrap().worker_autostart = false;

        resume_worker(&state).await;

        assert!(!state.supervisor.is_active());
        assert_eq!(*state.autostart_error.lock().unwrap(), None);
    }

    #[tokio::test]
    async fn resume_does_nothing_on_an_unpaired_device() {
        // A config can carry the intent from a previous pairing that was since revoked or reset.
        let state = test_state();
        state.config.lock().unwrap().worker_autostart = true;
        state.config.lock().unwrap().device_key = String::new();

        resume_worker(&state).await;

        assert!(!state.supervisor.is_active());
        assert_eq!(*state.autostart_error.lock().unwrap(), None);
    }

    #[test]
    fn status_reports_a_failed_resume_instead_of_a_bare_stopped_worker() {
        let state = test_state();
        *state.autostart_error.lock().unwrap() = Some("ไม่พบโมเดลที่เลือกใน Ollama".into());

        let status = worker_status(&state);

        assert_eq!(status["state"], "FAILED");
        assert_eq!(status["failure"], "ไม่พบโมเดลที่เลือกใน Ollama");
        assert_eq!(status["autoResume"], true);
        // FAILED with active:false is the combination the UI leaves Start enabled for.
        assert_eq!(status["active"], false);
    }

    #[test]
    fn status_is_the_supervisors_own_when_no_resume_failed() {
        let state = test_state();

        let status = worker_status(&state);

        assert_eq!(status, state.supervisor.snapshot());
        assert!(status.get("autoResume").is_none());
    }
}
