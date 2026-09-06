use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgePairingConfig {
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub device_key: String,
    #[serde(default = "default_cloud_url")]
    pub cloud_base_url: String,
    #[serde(default = "default_answer_mode")]
    pub answer_mode: String,
    #[serde(default = "default_headless_bin")]
    pub headless_bin: String,
    #[serde(default)]
    pub is_paired: bool,
    #[serde(default)]
    pub last_heartbeat_at: Option<String>,
}

fn default_cloud_url() -> String {
    "http://localhost:3000".to_string()
}

fn default_answer_mode() -> String {
    "HEADLESS_PLAN".to_string()
}

fn default_headless_bin() -> String {
    "codex".to_string()
}

impl Default for EdgePairingConfig {
    fn default() -> Self {
        Self {
            device_id: "zuri-edge-workstation".to_string(),
            device_key: "".to_string(),
            cloud_base_url: default_cloud_url(),
            answer_mode: default_answer_mode(),
            headless_bin: default_headless_bin(),
            is_paired: false,
            last_heartbeat_at: None,
        }
    }
}

pub struct AppState {
    pub config: Mutex<EdgePairingConfig>,
}

pub fn get_config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("zuri-edge-device");
    let _ = fs::create_dir_all(&path);
    path.push("edge-config.json");
    path
}

pub fn load_persisted_config() -> EdgePairingConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<EdgePairingConfig>(&content) {
                return cfg;
            }
        }
    }
    EdgePairingConfig::default()
}

pub fn persist_config(cfg: &EdgePairingConfig) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct CommandResult {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

#[tauri::command]
pub fn get_edge_status(state: State<'_, AppState>) -> EdgePairingConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn import_pairing_payload(json_str: String, state: State<'_, AppState>) -> CommandResult {
    #[derive(Deserialize)]
    struct RawPairing {
        #[serde(rename = "deviceId", alias = "device_id")]
        device_id: Option<String>,
        #[serde(rename = "key", alias = "token", alias = "device_key")]
        key: Option<String>,
        #[serde(rename = "cloudBaseUrl", alias = "cloud_base_url")]
        cloud_base_url: Option<String>,
        #[serde(rename = "businessName", alias = "business_name")]
        business_name: Option<String>,
    }

    match serde_json::from_str::<RawPairing>(&json_str) {
        Ok(parsed) => {
            let mut cfg = state.config.lock().unwrap();
            if let Some(id) = parsed.device_id {
                cfg.device_id = id;
            }
            if let Some(k) = parsed.key {
                cfg.device_key = k;
            }
            if let Some(url) = parsed.cloud_base_url {
                cfg.cloud_base_url = url;
            }
            cfg.is_paired = !cfg.device_key.is_empty();

            if let Err(e) = persist_config(&cfg) {
                return CommandResult {
                    success: false,
                    message: format!("Failed to save config: {}", e),
                    data: None,
                };
            }

            CommandResult {
                success: true,
                message: format!(
                    "Successfully paired device '{}' for {}",
                    cfg.device_id,
                    parsed.business_name.unwrap_or_else(|| "Business".to_string())
                ),
                data: Some(serde_json::to_value(&*cfg).unwrap()),
            }
        }
        Err(e) => CommandResult {
            success: false,
            message: format!("Invalid JSON pairing format: {}", e),
            data: None,
        },
    }
}

#[tauri::command]
pub async fn send_heartbeat_now(state: State<'_, AppState>) -> Result<CommandResult, String> {
    let (device_id, device_key, base_url) = {
        let cfg = state.config.lock().unwrap();
        (cfg.device_id.clone(), cfg.device_key.clone(), cfg.cloud_base_url.clone())
    };

    if device_key.is_empty() {
        return Ok(CommandResult {
            success: false,
            message: "Device is not paired yet (Missing Device Key)".to_string(),
            data: None,
        });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/api/agent/heartbeat", base_url.trim_end_matches('/'));

    let payload = serde_json::json!({
        "deviceId": device_id,
        "status": "healthy",
        "runtime": "tauri-rust-desktop",
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", device_key))
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                let mut cfg = state.config.lock().unwrap();
                cfg.last_heartbeat_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = persist_config(&cfg);
                Ok(CommandResult {
                    success: true,
                    message: "Heartbeat accepted by Zuri Cloud (Status: ONLINE)".to_string(),
                    data: Some(serde_json::json!({ "httpStatus": status.as_u16() })),
                })
            } else {
                Ok(CommandResult {
                    success: false,
                    message: format!("Cloud returned error HTTP {}", status.as_u16()),
                    data: None,
                })
            }
        }
        Err(e) => Ok(CommandResult {
            success: false,
            message: format!("Network error reaching Cloud: {}", e),
            data: None,
        }),
    }
}

#[tauri::command]
pub fn check_headless_cli(bin: String) -> CommandResult {
    let target_bin = if bin.is_empty() { "codex" } else { &bin };
    match Command::new(target_bin).arg("--version").output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let version = if !stdout.is_empty() { stdout } else { stderr };
            CommandResult {
                success: true,
                message: format!("Found CLI: {}", version),
                data: Some(serde_json::json!({ "bin": target_bin, "version": version })),
            }
        }
        Err(e) => CommandResult {
            success: false,
            message: format!("CLI binary '{}' not found in PATH: {}", target_bin, e),
            data: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = EdgePairingConfig::default();
        assert_eq!(cfg.answer_mode, "HEADLESS_PLAN");
        assert_eq!(cfg.headless_bin, "codex");
        assert_eq!(cfg.is_paired, false);
    }

    #[test]
    fn test_import_pairing_json_parsing() {
        let raw_json = r#"{
            "deviceId": "DEV-TEST-001",
            "key": "edgk_live_1234567890abcdef",
            "cloudBaseUrl": "https://zuri.example.com",
            "businessName": "SmartGift Thailand"
        }"#;

        #[derive(Deserialize)]
        struct RawPairing {
            #[serde(rename = "deviceId", alias = "device_id")]
            device_id: Option<String>,
            #[serde(rename = "key", alias = "token", alias = "device_key")]
            key: Option<String>,
            #[serde(rename = "cloudBaseUrl", alias = "cloud_base_url")]
            cloud_base_url: Option<String>,
            #[serde(rename = "businessName", alias = "business_name")]
            business_name: Option<String>,
        }

        let parsed: RawPairing = serde_json::from_str(raw_json).expect("valid json");
        assert_eq!(parsed.device_id.as_deref(), Some("DEV-TEST-001"));
        assert_eq!(parsed.key.as_deref(), Some("edgk_live_1234567890abcdef"));
        assert_eq!(parsed.cloud_base_url.as_deref(), Some("https://zuri.example.com"));
        assert_eq!(parsed.business_name.as_deref(), Some("SmartGift Thailand"));
    }
}

