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
    state.supervisor.snapshot()
}
#[tauri::command]
pub async fn start_worker(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
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
    state.supervisor.stop().await
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
}
