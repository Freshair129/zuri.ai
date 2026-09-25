// @spec FR-150 — local provider settings and diagnostics for the retained Knowledge/RAG runtime.
use crate::{
    commands::{get_config_path, persist_config, AppState},
    providers::{self, ProviderSettings},
};
use serde_json::Value;
use tauri::State;

pub fn data_root() -> Result<std::path::PathBuf, String> {
    get_config_path()?
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "ไม่พบโฟลเดอร์ข้อมูล Desktop".into())
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
    state.providers.cancel_login(&provider).await
}
