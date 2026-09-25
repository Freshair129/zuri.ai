use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

// Provider preferences remain in the historical config file. Unknown legacy fields are retained
// as opaque JSON so removing the Edge executor does not erase locally stored records or secrets.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct DesktopConfig {
    pub provider_settings: crate::providers::ProviderSettings,
    #[serde(flatten)]
    pub retained_legacy_fields: serde_json::Map<String, Value>,
}
impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            provider_settings: crate::providers::ProviderSettings::default(),
            retained_legacy_fields: serde_json::Map::new(),
        }
    }
}
pub struct AppState {
    pub config: Mutex<DesktopConfig>,
    pub load_error: Mutex<Option<String>>,
    pub lifecycle: tokio::sync::Mutex<()>,
    pub providers: crate::providers::ProviderManager,
}
impl AppState {
    pub fn load() -> Self {
        let (cfg, error) = match load_persisted_config() {
            Ok(value) => (value, None),
            Err(error) => (DesktopConfig::default(), Some(error)),
        };
        Self {
            config: Mutex::new(cfg),
            load_error: Mutex::new(error),
            lifecycle: tokio::sync::Mutex::new(()),
            providers: crate::providers::ProviderManager::default(),
        }
    }
}
pub fn get_config_path() -> Result<PathBuf, String> {
    // Keep using the existing location so provider preferences and historical records stay put.
    Ok(dirs::config_dir()
        .ok_or("ไม่พบโฟลเดอร์การตั้งค่าของ Windows")?
        .join("zuri-edge-device")
        .join("edge-config.json"))
}
pub fn persist_at(cfg: &DesktopConfig, path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("ตำแหน่งการตั้งค่าไม่ถูกต้อง")?;
    fs::create_dir_all(parent).map_err(|_| "สร้างโฟลเดอร์การตั้งค่าไม่ได้")?;
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "บันทึกการตั้งค่าไม่ได้")?;
    temp.persist(path)
        .map_err(|_| "บันทึกการตั้งค่าไม่ได้ ข้อมูลเดิมยังคงอยู่")?;
    Ok(())
}
pub fn persist_config(cfg: &DesktopConfig) -> Result<(), String> {
    persist_at(cfg, &get_config_path()?)
}
/// Parse the stored config, tolerating a UTF-8 BOM.
///
/// This app never writes one, but Windows tooling does by default — PowerShell's
/// `Set-Content -Encoding utf8` and Notepad both add one — and serde rejects it as malformed. The
/// failure is out of proportion to the cause: the config is discarded and provider preferences
/// appear to have vanished. Skipping three bytes is cheaper than that.
fn decode_config(content: &str) -> Result<DesktopConfig, String> {
    serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
        .map_err(|_| "ไฟล์การตั้งค่าเสียหาย กรุณาตรวจสอบไฟล์แล้วลองใหม่".into())
}

pub fn load_persisted_config() -> Result<DesktopConfig, String> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(DesktopConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|_| "อ่านการตั้งค่าไม่ได้ กรุณาลองใหม่")?;
    decode_config(&content)
}

#[tauri::command]
pub fn get_desktop_status(state: State<'_, AppState>) -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "configuration_error": state.load_error.lock().unwrap().clone(),
    })
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

    #[cfg(windows)]
    #[test]
    fn a_windows_written_config_with_a_bom_still_loads() {
        // The exact shape PowerShell's `Set-Content -Encoding utf8` produces. Before this was
        // tolerated it made provider preferences appear to vanish on the next launch.
        let cfg = DesktopConfig::default();
        let json = serde_json::to_string_pretty(&cfg).unwrap();

        let plain = decode_config(&json).expect("plain JSON must load");
        let with_bom =
            decode_config(&format!("\u{feff}{json}")).expect("a BOM must not lose the config");

        assert_eq!(with_bom.provider_settings, plain.provider_settings);
        assert!(decode_config("not json at all").is_err());
    }

    #[test]
    fn provider_save_preserves_opaque_legacy_records() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("desktop-config.json");
        let original = r#"{
          "device_id": "legacy-id",
          "device_key": "dpapi:opaque-protected-value",
          "business_name": "legacy-record",
          "provider_settings": {"provider":"ollama"}
        }"#;
        let mut cfg = decode_config(original).unwrap();
        persist_at(&cfg, &path).unwrap();
        cfg.provider_settings.provider = "claude".into();
        cfg.provider_settings.claude_model = "claude-fixture".into();
        cfg.provider_settings.codex_model = "codex-fixture".into();
        cfg.provider_settings.allow_cloud = true;
        persist_at(&cfg, &path).unwrap();
        let content: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(content["device_id"], "legacy-id");
        assert_eq!(content["device_key"], "dpapi:opaque-protected-value");
        assert_eq!(content["business_name"], "legacy-record");
        let stored: DesktopConfig = serde_json::from_value(content).unwrap();
        assert_eq!(stored.provider_settings, cfg.provider_settings);
    }
}
