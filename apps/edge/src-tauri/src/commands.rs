use crate::{
    credential_store,
    pairing::{self, Pending, Started},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

// @spec FR-144, FR-141, SEC-025 — native pairing state, protected storage and truthful telemetry.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct EdgePairingConfig {
    pub device_id: String,
    pub device_key: String,
    pub cloud_base_url: String,
    pub business_name: String,
    pub answer_mode: String,
    pub headless_bin: String,
    pub is_paired: bool,
    pub last_heartbeat_at: Option<String>,
    pub provider_settings: crate::providers::ProviderSettings,
    // The operator's last explicit intent for the worker, not a record of what is running.
    // Set when Start succeeds, cleared when Stop is pressed — so closing the window (which stops
    // the child) and a power cut are both "still wanted", while an explicit Stop is not.
    pub worker_autostart: bool,
}
impl Default for EdgePairingConfig {
    fn default() -> Self {
        Self {
            device_id: format!("EDGE-{}", uuid::Uuid::new_v4().simple()),
            device_key: String::new(),
            cloud_base_url: option_env!("ZURI_DESKTOP_SERVER_URL")
                .unwrap_or("")
                .to_string(),
            business_name: String::new(),
            answer_mode: "HEADLESS_PLAN".into(),
            headless_bin: "codex".into(),
            is_paired: false,
            last_heartbeat_at: None,
            provider_settings: crate::providers::ProviderSettings::default(),
            worker_autostart: false,
        }
    }
}
pub struct AppState {
    pub config: Mutex<EdgePairingConfig>,
    pub load_error: Mutex<Option<String>>,
    pub verified: AtomicBool,
    pub pairing: tokio::sync::Mutex<Option<Pending>>,
    pub lifecycle: tokio::sync::Mutex<()>,
    pub supervisor: crate::supervisor::Supervisor,
    pub providers: crate::providers::ProviderManager,
    pub quitting: AtomicBool,
    // Why the automatic resume gave up, if it did. Reported through get_worker_status rather than
    // kept here, because a resume that fails silently is the failure this feature exists to remove.
    pub autostart_error: Mutex<Option<String>>,
}
impl AppState {
    pub fn load() -> Self {
        let (cfg, error) = match load_persisted_config() {
            Ok(value) => (value, None),
            Err(error) => (EdgePairingConfig::default(), Some(error)),
        };
        Self {
            config: Mutex::new(cfg),
            load_error: Mutex::new(error),
            verified: AtomicBool::new(false),
            pairing: tokio::sync::Mutex::new(None),
            lifecycle: tokio::sync::Mutex::new(()),
            supervisor: crate::supervisor::Supervisor::default(),
            providers: crate::providers::ProviderManager::default(),
            quitting: AtomicBool::new(false),
            autostart_error: Mutex::new(None),
        }
    }
}
pub fn get_config_path() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("ไม่พบโฟลเดอร์การตั้งค่าของ Windows")?
        .join("zuri-edge-device")
        .join("edge-config.json"))
}
pub fn persist_at(cfg: &EdgePairingConfig, path: &Path) -> Result<(), String> {
    let mut stored = cfg.clone();
    stored.device_key = credential_store::protect(&cfg.device_key)?;
    let parent = path.parent().ok_or("ตำแหน่งการตั้งค่าไม่ถูกต้อง")?;
    fs::create_dir_all(parent).map_err(|_| "สร้างโฟลเดอร์การตั้งค่าไม่ได้")?;
    let bytes = serde_json::to_vec_pretty(&stored).map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    temp.persist(path)
        .map_err(|_| "บันทึกการตั้งค่าไม่ได้ ข้อมูลเดิมยังคงอยู่")?;
    Ok(())
}
pub fn persist_config(cfg: &EdgePairingConfig) -> Result<(), String> {
    persist_at(cfg, &get_config_path()?)
}
/// Parse the stored config, tolerating a UTF-8 BOM.
///
/// This app never writes one, but Windows tooling does by default — PowerShell's
/// `Set-Content -Encoding utf8` and Notepad both add one — and serde rejects it as malformed. The
/// failure is out of proportion to the cause: the config is discarded, `AppState` falls back to an
/// unpaired default, and a device that is paired and configured comes up looking like a fresh
/// install with its worker silently not resuming. Skipping three bytes is cheaper than that.
fn decode_config(content: &str) -> Result<EdgePairingConfig, String> {
    serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| "ไฟล์การตั้งค่าเสียหาย กรุณาเชื่อมต่อใหม่".into())
}

pub fn load_persisted_config() -> Result<EdgePairingConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(EdgePairingConfig::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|_| "อ่านการตั้งค่าไม่ได้ กรุณาลองใหม่หรือนำเข้าไฟล์จับคู่")?;
    let mut cfg = decode_config(&content)?;
    if cfg.device_key.starts_with("dpapi:") {
        cfg.device_key = credential_store::unprotect(&cfg.device_key)?;
    } else if !cfg.device_key.is_empty() {
        // Only this Desktop's own old file; never read/import the legacy checkout's .env.
        if !cfg.device_key.starts_with("edgk_") {
            return Err("กุญแจเดิมไม่ถูกต้อง กรุณาเชื่อมต่อใหม่".into());
        }
        persist_at(&cfg, &path)?;
    }
    cfg.is_paired = !cfg.device_key.is_empty();
    Ok(cfg)
}
pub fn status_value(cfg: &EdgePairingConfig, verified: bool, error: Option<String>) -> Value {
    json!({
        "device_id":cfg.device_id, "cloud_base_url":cfg.cloud_base_url, "business_name":cfg.business_name,
        "configured":!cfg.device_key.is_empty(), "server_verified":verified,
        "last_heartbeat_at":cfg.last_heartbeat_at, "worker_state":"UNVERIFIED",
        "version":env!("CARGO_PKG_VERSION"), "load_error":error,
    })
}
#[tauri::command]
pub fn get_edge_status(state: State<'_, AppState>) -> Value {
    let mut value = status_value(
        &state.config.lock().unwrap(),
        state.verified.load(Ordering::SeqCst),
        state.load_error.lock().unwrap().clone(),
    );
    value["worker_state"] = state.supervisor.snapshot()["state"].clone();
    value
}
#[tauri::command]
pub async fn import_pairing_payload(
    json_str: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    if state.supervisor.is_active() {
        return Err("กรุณาหยุดรับงานก่อนเปลี่ยนการจับคู่".into());
    }
    if json_str.len() > 16384 {
        return Err("ไฟล์จับคู่มีขนาดเกินกำหนด".into());
    }
    let mut pending = state.pairing.lock().await;
    if pending.is_some() {
        return Err("กรุณายกเลิกคำขอที่กำลังรอก่อนนำเข้าไฟล์".into());
    }
    let value: Value = serde_json::from_str(&json_str).map_err(|_| "รูปแบบไฟล์จับคู่ไม่ถูกต้อง")?;
    let mut cfg = pairing::parse_pairing(&value)?;
    // Same reason as the browser-pairing path: the payload describes the device's identity, not
    // how this machine was set up, so the local provider choice and worker intent survive it.
    {
        let existing = state.config.lock().unwrap();
        cfg.provider_settings = existing.provider_settings.clone();
        cfg.worker_autostart = existing.worker_autostart;
    }
    persist_config(&cfg)?;
    *state.config.lock().unwrap() = cfg;
    *state.load_error.lock().unwrap() = None;
    state.verified.store(false, Ordering::SeqCst);
    *pending = None;
    Ok(json!({"success":true,"message":"บันทึกการจับคู่แล้ว กรุณาตรวจการเชื่อมต่อ"}))
}
#[tauri::command]
pub async fn connect_zuri(
    base_url: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    if state.supervisor.is_active() {
        return Err("กรุณาหยุดรับงานก่อนเปลี่ยนการจับคู่".into());
    }
    let mut pending = state.pairing.lock().await;
    if let Some(current) = pending.as_ref() {
        return serde_json::to_value(current.view(false)?).map_err(|_| "อ่านคำขอไม่ได้".into());
    }
    let origin = pairing::validate_origin(&base_url)?;
    let id = state.config.lock().unwrap().device_id.clone();
    let label: String = std::env::var("COMPUTERNAME")
        .unwrap_or_else(|_| "Zuri Desktop".into())
        .chars()
        .take(80)
        .collect();
    let response = pairing::client()?
        .post(format!("{origin}/api/edge/pairing/start"))
        .json(&json!({"deviceId":id, "label":label}))
        .send()
        .await
        .map_err(|_| "ติดต่อ Zuri ไม่สำเร็จ ตรวจที่อยู่เซิร์ฟเวอร์แล้วลองใหม่")?;
    let start: Started = serde_json::from_value(pairing::json_response(response).await?)
        .map_err(|_| "เซิร์ฟเวอร์ยังไม่พร้อมรับคำขอ กรุณาลองใหม่")?;
    pairing::validate_start(&start, &origin)?;
    let opened = app
        .opener()
        .open_url(&start.approval_url, None::<&str>)
        .is_ok();
    let current = Pending {
        start,
        origin,
        received: None,
    };
    let view = current.view(opened)?;
    *pending = Some(current);
    serde_json::to_value(view).map_err(|_| "อ่านคำขอไม่ได้".into())
}
#[tauri::command]
pub async fn open_pairing_browser(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pending = state.pairing.lock().await;
    let current = pending.as_ref().ok_or("กรุณาเริ่มคำขอใหม่")?;
    pairing::validate_start(&current.start, &current.origin)?;
    app.opener()
        .open_url(&current.start.approval_url, None::<&str>)
        .map_err(|_| "เปิดเบราว์เซอร์ไม่ได้ กรุณาสแกน QR".into())
}
#[tauri::command]
pub async fn poll_pairing(cancel: bool, state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    if state.supervisor.is_active() {
        return Err("กรุณาหยุดรับงานก่อนเปลี่ยนการจับคู่".into());
    }
    let mut slot = state.pairing.lock().await;
    if slot.is_none() && cancel {
        return Ok(json!({"state":"CANCELLED"}));
    }
    let current = slot.as_mut().ok_or("ไม่มีคำขอที่กำลังรอ")?;
    if cancel {
        if current.received.is_some() {
            return Err("ได้รับกุญแจแล้ว กรุณากดตรวจผลอีกครั้งเพื่อบันทึกให้สำเร็จ".into());
        }
        // Dropping the private capability locally stops redemption even offline.
        // Server cancellation is best effort; an unpolled request expires without minting.
        let _ = pairing::client()?
            .post(format!("{}/api/edge/pairing/poll", current.origin))
            .bearer_auth(&current.start.device_secret)
            .json(&json!({"requestId":current.start.request_id,"cancel":true}))
            .send()
            .await;
        *slot = None;
        return Ok(json!({"state":"CANCELLED"}));
    }
    if current.received.is_none() {
        let response = pairing::client()?
            .post(format!("{}/api/edge/pairing/poll", current.origin))
            .bearer_auth(&current.start.device_secret)
            .json(&json!({"requestId":current.start.request_id,"cancel":cancel}))
            .send()
            .await
            .map_err(|_| "ขาดการเชื่อมต่อ กรุณาลองตรวจสถานะอีกครั้ง")?;
        let value = match pairing::json_response(response).await {
            Ok(value) => value,
            Err(error) => {
                *slot = None;
                return Ok(json!({"state":"FAILED","message":error}));
            }
        };
        match value.get("state").and_then(Value::as_str) {
            Some("PAIRED") => {
                let cfg = pairing::parse_pairing(value.get("pairing").ok_or("ไม่มีข้อมูลจับคู่")?)?;
                if cfg.cloud_base_url != current.origin
                    || cfg.device_id != state.config.lock().unwrap().device_id
                {
                    *slot = None;
                    return Err("ข้อมูลจับคู่ไม่ตรงกับคำขอ".into());
                }
                current.received = Some(cfg);
            }
            Some("CANCELLED" | "DENIED") => {
                *slot = None;
                return Ok(value);
            }
            Some("PENDING" | "WAIT" | "REDEEMING") => return Ok(value),
            _ => {
                *slot = None;
                return Err("สถานะคำขอจากเซิร์ฟเวอร์ไม่ถูกต้อง".into());
            }
        }
    }
    // Keep a received key in native memory if disk persistence fails, so Retry saves
    // the same key instead of redeeming/minting again.
    let mut cfg = current.received.as_ref().unwrap().clone();
    // Carry forward what the operator configured on this machine. `parse_pairing` builds a fresh
    // config from the server's payload, which knows about neither the local provider choice nor
    // whether the worker was meant to be running — re-pairing must not silently reset either.
    {
        let existing = state.config.lock().unwrap();
        cfg.provider_settings = existing.provider_settings.clone();
        cfg.worker_autostart = existing.worker_autostart;
    }
    persist_config(&cfg)?;
    *state.config.lock().unwrap() = cfg;
    *state.load_error.lock().unwrap() = None;
    state.verified.store(false, Ordering::SeqCst);
    *slot = None;
    Ok(json!({"state":"PAIRED"}))
}
#[tauri::command]
pub async fn send_heartbeat_now(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state.lifecycle.lock().await;
    if state.supervisor.is_active() {
        state.supervisor.heartbeat().await?;
        return Ok(
            json!({"success":true,"message":"ขอให้ตัวประมวลผลตรวจการเชื่อมต่อแล้ว ดูเวลายืนยันล่าสุด"}),
        );
    }
    let cfg = state.config.lock().unwrap().clone();
    state.verified.store(false, Ordering::SeqCst);
    if cfg.device_key.is_empty() {
        return Err("กรุณาเชื่อมต่อ Zuri ก่อน".into());
    }
    let origin = pairing::validate_origin(&cfg.cloud_base_url)?;
    let response = pairing::client()?.post(format!("{origin}/api/agent/heartbeat"))
        .bearer_auth(&cfg.device_key)
        // Shell-only verification cannot advertise a healthy execution worker.
        .json(&json!({"deviceId":cfg.device_id,"status":"unavailable","timestamp":chrono::Utc::now().to_rfc3339()}))
        .send().await.map_err(|_| "ติดต่อ Zuri ไม่สำเร็จ")?;
    let value = pairing::json_response(response).await?;
    if value.get("state").and_then(Value::as_str) == Some("WAIT") {
        return Err("กรุณารอสักครู่แล้วตรวจใหม่".into());
    }
    if value.get("acknowledged") != Some(&Value::Bool(true))
        || value.get("deviceId").and_then(Value::as_str) != Some(&cfg.device_id)
    {
        return Err("Zuri ยังไม่ได้ยืนยันการเชื่อมต่อของเครื่องนี้".into());
    }
    let mut cfg = state.config.lock().unwrap();
    cfg.last_heartbeat_at = Some(chrono::Utc::now().to_rfc3339());
    persist_config(&cfg)?;
    state.verified.store(true, Ordering::SeqCst);
    Ok(json!({"success":true,"message":"Zuri ยืนยันการเชื่อมต่อแล้ว สถานะตัวประมวลผลต้องตรวจแยก"}))
}
#[tauri::command]
pub async fn check_headless_cli(bin: String) -> Result<Value, String> {
    crate::providers::diagnose_cli(&bin).await
}
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}
#[derive(Serialize)]
pub struct CommandResult {
    pub success: bool,
    pub message: String,
    pub data: Option<Value>,
}

fn unavailable_updater(config: Option<&Value>) -> Option<CommandResult> {
    let configured = config.is_some_and(|config| {
        config.get("pubkey").and_then(Value::as_str).is_some_and(|key| !key.trim().is_empty())
            && config.get("endpoints").and_then(Value::as_array).is_some_and(|urls| {
                !urls.is_empty() && urls.iter().all(|url| url.as_str().is_some_and(|url| !url.trim().is_empty()))
            })
    });
    if configured {
        return None;
    }
    Some(CommandResult {
        success: false,
        message: "ยังไม่เปิดใช้การอัปเดตอัตโนมัติในแพ็กเกจนี้ กรุณาใช้แพ็กเกจรุ่นใหม่จากผู้ดูแล".into(),
        data: Some(json!({
            "code": "UPDATER_UNAVAILABLE",
            "available": false,
            "currentVersion": env!("CARGO_PKG_VERSION")
        })),
    })
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<CommandResult, String> {
    use tauri_plugin_updater::UpdaterExt;

    if let Some(result) = unavailable_updater(app.config().plugins.0.get("updater")) {
        return Ok(result);
    }

    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => Ok(CommandResult {
                success: true,
                message: format!("พบอัปเดตเวอร์ชันใหม่ v{}", update.version),
                data: Some(serde_json::json!({
                    "hasUpdate": true,
                    "version": update.version,
                    "currentVersion": env!("CARGO_PKG_VERSION"),
                    "body": update.body.clone().unwrap_or_default(),
                    "date": update.date.map(|d| d.to_string())
                })),
            }),
            Ok(None) => Ok(CommandResult {
                success: true,
                message: format!("คุณกำลังใช้งานเวอร์ชันล่าสุด (v{})", env!("CARGO_PKG_VERSION")),
                data: Some(serde_json::json!({
                    "hasUpdate": false,
                    "currentVersion": env!("CARGO_PKG_VERSION")
                })),
            }),
            Err(e) => Ok(CommandResult {
                success: false,
                message: format!("ไม่สามารถตรวจสอบอัปเดตได้: {}", e),
                data: None,
            }),
        },
        Err(e) => Ok(CommandResult {
            success: false,
            message: format!("Updater ไม่พร้อมใช้งาน: {}", e),
            data: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_updater_is_unavailable_without_claiming_latest() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let result = unavailable_updater(config.pointer("/plugins/updater")).unwrap();
        assert!(!result.success);
        let data = result.data.unwrap();
        assert_eq!(data["code"], "UPDATER_UNAVAILABLE");
        assert_eq!(data["available"], false);
        assert_eq!(data["currentVersion"], env!("CARGO_PKG_VERSION"));
        assert!(data.get("hasUpdate").is_none());
        for partial in [None, Some(json!({"pubkey":"", "endpoints":["https://example.invalid/feed"]})), Some(json!({"pubkey":"fixture", "endpoints":[]}))] {
            assert!(unavailable_updater(partial.as_ref()).is_some());
        }
    }

    #[test]
    fn status_never_serializes_key_or_guesses_worker_readiness() {
        let cfg = EdgePairingConfig {
            device_key: "edgk_synthetic_test_credential".into(),
            ..Default::default()
        };
        let status = status_value(&cfg, false, Some("test error".into()));
        assert!(!status.to_string().contains(&cfg.device_key));
        assert_eq!(status["configured"], true);
        assert_eq!(status["server_verified"], false);
        assert_eq!(status["worker_state"], "UNVERIFIED");
        assert_eq!(status["load_error"], "test error");
    }
    #[cfg(windows)]
    #[test]
    fn a_windows_written_config_with_a_bom_still_loads() {
        // The exact shape PowerShell's `Set-Content -Encoding utf8` produces. Before this was
        // tolerated it cost a paired device its identity on the next launch: the config was
        // discarded and the app came up unpaired, so the worker never resumed.
        let cfg = EdgePairingConfig {
            device_key: "edgk_synthetic_test_credential".into(),
            business_name: "SmartGift".into(),
            worker_autostart: true,
            ..Default::default()
        };
        let json = serde_json::to_string_pretty(&cfg).unwrap();

        let plain = decode_config(&json).expect("plain JSON must load");
        let with_bom =
            decode_config(&format!("\u{feff}{json}")).expect("a BOM must not lose the config");

        assert_eq!(with_bom.device_id, plain.device_id);
        assert_eq!(with_bom.business_name, "SmartGift");
        assert!(with_bom.worker_autostart);
        assert!(decode_config("not json at all").is_err());
    }

    #[test]
    fn protected_file_can_be_replaced_without_plaintext_key() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("edge-config.json");
        let mut cfg = EdgePairingConfig {
            device_key: "edgk_synthetic_test_credential".into(),
            ..Default::default()
        };
        persist_at(&cfg, &path).unwrap();
        cfg.business_name = "Second".into();
        cfg.provider_settings.provider = "claude".into();
        cfg.provider_settings.claude_model = "claude-fixture".into();
        cfg.provider_settings.codex_model = "codex-fixture".into();
        cfg.provider_settings.allow_cloud = true;
        persist_at(&cfg, &path).unwrap();
        let content = fs::read_to_string(path).unwrap();
        assert!(!content.contains(&cfg.device_key));
        let stored: EdgePairingConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(stored.business_name, "Second");
        assert_eq!(stored.provider_settings, cfg.provider_settings);
        assert_eq!(
            credential_store::unprotect(&stored.device_key).unwrap(),
            cfg.device_key
        );
    }
}
