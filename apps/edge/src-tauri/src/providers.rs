// @spec FR-150-P2, EDGE-DESKTOP-TAURI-RUNTIME section 10 — selected provider settings,
// managed CLI homes, truthful CLI auth state and bounded loopback Ollama discovery.
//
// The module never reads credential files. Official CLIs own credential persistence; callers run
// the fixed command specs below with a managed home.

use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Ollama,
    Codex,
    Claude,
}

impl Default for ProviderId {
    fn default() -> Self {
        Self::Ollama
    }
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderState {
    Missing,
    LoggedOut,
    Authenticating,
    Ready,
    Failed,
    Blocked,
}

impl Default for ProviderState {
    fn default() -> Self {
        Self::Blocked
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderSettings {
    pub provider: String,
    pub ollama_base_url: String,
    pub ollama_model: String,
    pub codex_model: String,
    pub claude_model: String,
    pub allow_cloud: bool,
}

pub const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            provider: "ollama".into(),
            ollama_base_url: DEFAULT_OLLAMA_BASE_URL.into(),
            ollama_model: String::new(),
            codex_model: String::new(),
            claude_model: String::new(),
            allow_cloud: false,
        }
    }
}

impl ProviderSettings {
    pub fn selected_model(&self) -> &str {
        match self.provider.as_str() {
            "ollama" => &self.ollama_model,
            "codex" => &self.codex_model,
            "claude" => &self.claude_model,
            _ => "",
        }
    }
}

pub fn parse_provider_id(raw: &str) -> Result<ProviderId, String> {
    match raw.trim() {
        "ollama" => Ok(ProviderId::Ollama),
        "codex" => Ok(ProviderId::Codex),
        "claude" => Ok(ProviderId::Claude),
        _ => Err("เลือก provider ได้เฉพาะ Ollama, Codex หรือ Claude".into()),
    }
}

fn validate_model_name(name: &str) -> Result<(), String> {
    if name.len() > 120 || name.trim() != name || name.chars().any(|c| c.is_control()) {
        return Err("ชื่อโมเดลยาวหรือมีอักขระที่ไม่รองรับ".into());
    }
    Ok(())
}

pub fn validate_settings(settings: &ProviderSettings) -> Result<(), String> {
    let provider = parse_provider_id(&settings.provider)?;
    if settings.provider.trim() != settings.provider {
        return Err("ชื่อ provider ไม่ถูกต้อง".into());
    }
    validate_ollama_base_url(&settings.ollama_base_url)?;
    validate_model_name(&settings.ollama_model)?;
    validate_model_name(&settings.codex_model)?;
    validate_model_name(&settings.claude_model)?;
    if settings.selected_model().trim().is_empty() {
        return Err("กรุณาเลือกโมเดลของ provider นี้ก่อนบันทึก".into());
    }
    if provider == ProviderId::Ollama && settings.allow_cloud {
        return Err("Ollama ไม่สามารถเปิดสิทธิ์ cloud โดยอัตโนมัติได้".into());
    }
    Ok(())
}

pub fn provider_home(root: &Path, provider: &str) -> Result<PathBuf, String> {
    let provider = parse_provider_id(provider)?;
    if provider == ProviderId::Ollama {
        return Err("Ollama ไม่มี credential home".into());
    }
    if !root.is_absolute() {
        return Err("managed provider root must be an absolute path".into());
    }
    let providers_root = root.join("providers");
    let home = providers_root.join(provider.as_str());
    for path in [root, providers_root.as_path(), home.as_path()] {
        if existing_path_is_link(path)? {
            return Err("managed provider home cannot use a symlink or junction".into());
        }
    }
    Ok(home)
}

fn existing_path_is_link(path: &Path) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("อ่าน managed provider home ไม่ได้".into()),
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        Ok(metadata.file_type().is_symlink()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }
    #[cfg(not(windows))]
    {
        Ok(metadata.file_type().is_symlink())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub provider: ProviderId,
    pub state: ProviderState,
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authentication_url: Option<String>,
}

impl ProviderStatus {
    pub fn blocked(provider: ProviderId, message: impl Into<String>) -> Self {
        Self {
            provider,
            state: ProviderState::Blocked,
            installed: false,
            authenticated: false,
            version: None,
            message: message.into(),
            authentication_url: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OllamaDiscovery {
    pub base_url: String,
    pub available: bool,
    pub models: Vec<OllamaModel>,
    pub selected_model: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderCommand {
    pub program: &'static str,
    pub args: &'static [&'static str],
    pub home_env: &'static str,
}

struct ManagedLogin {
    child: tokio::process::Child,
    started_at: Instant,
}

/// Owns only children started by this Desktop instance. The official CLI owns browser auth and
/// credential persistence; this manager never opens or parses credential files.
pub struct ProviderManager {
    logins: Arc<tokio::sync::Mutex<HashMap<ProviderId, ManagedLogin>>>,
    roots: tokio::sync::Mutex<HashMap<ProviderId, PathBuf>>,
    failures: Arc<tokio::sync::Mutex<HashMap<ProviderId, String>>>,
}

impl Default for ProviderManager {
    fn default() -> Self {
        Self {
            logins: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            roots: tokio::sync::Mutex::new(HashMap::new()),
            failures: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

impl ProviderManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn status(&self, provider: &str, root: &Path) -> Result<serde_json::Value, String> {
        let provider_id = parse_provider_id(provider)?;
        if provider_id == ProviderId::Ollama {
            return serde_json::to_value(ProviderStatus::blocked(
                provider_id,
                "Ollama ใช้การค้นหา /api/tags แทนสถานะ login",
            ))
            .map_err(|_| "อ่านสถานะ provider ไม่ได้".into());
        }
        let home = provider_home(root, provider)?;
        std::fs::create_dir_all(&home).map_err(|_| "สร้าง managed provider home ไม่ได้")?;
        self.roots
            .lock()
            .await
            .insert(provider_id, root.to_path_buf());
        let command = status_command(provider_id)?;
        let output = run_cli(command, &home, Duration::from_secs(5)).await;
        let mut status = match output {
            Ok(output) => classify_cli_status(
                provider_id,
                true,
                output.success,
                &output.stdout,
                &output.stderr,
            ),
            Err(ProviderCommandError::Missing) => {
                classify_cli_status(provider_id, false, false, &[], &[])
            }
            Err(ProviderCommandError::Timeout) => ProviderStatus {
                provider: provider_id,
                state: ProviderState::Failed,
                installed: true,
                authenticated: false,
                version: None,
                message: "ตรวจสถานะ CLI เกินเวลา".into(),
                authentication_url: None,
            },
            Err(ProviderCommandError::Failed) => ProviderStatus {
                provider: provider_id,
                state: ProviderState::Failed,
                installed: true,
                authenticated: false,
                version: None,
                message: "ตรวจสถานะ CLI ไม่สำเร็จ".into(),
                authentication_url: None,
            },
        };

        let recorded_failure = {
            let mut failures = self.failures.lock().await;
            if status.state == ProviderState::Ready {
                failures.remove(&provider_id);
                None
            } else {
                failures.get(&provider_id).cloned()
            }
        };
        if let Some(message) = recorded_failure {
            status = ProviderStatus {
                provider: provider_id,
                state: ProviderState::Failed,
                installed: true,
                authenticated: false,
                version: status.version,
                message,
                authentication_url: None,
            };
        }

        let mut child_to_stop = None;
        let mut login_timed_out = false;
        {
            let mut logins = self.logins.lock().await;
            let lifecycle = logins.get_mut(&provider_id).map(|login| {
                let timed_out =
                    login.started_at.elapsed() > Duration::from_secs(LOGIN_TIMEOUT_SECS);
                let running = matches!(login.child.try_wait(), Ok(None));
                (timed_out, running)
            });
            if let Some((expired, running)) = lifecycle {
                if expired {
                    login_timed_out = true;
                    child_to_stop = logins.remove(&provider_id);
                    status = ProviderStatus {
                        provider: provider_id,
                        state: ProviderState::Failed,
                        installed: status.installed,
                        authenticated: false,
                        version: status.version,
                        message: "การเข้าสู่ระบบเกินเวลาที่กำหนด".into(),
                        authentication_url: None,
                    };
                } else if running && status.state != ProviderState::Ready {
                    status.state = ProviderState::Authenticating;
                    status.authenticated = false;
                    status.message = "กำลังรอการยืนยันในเบราว์เซอร์".into();
                } else if !running || status.state == ProviderState::Ready {
                    child_to_stop = logins.remove(&provider_id);
                }
            }
        }
        if login_timed_out {
            self.failures
                .lock()
                .await
                .insert(provider_id, "การเข้าสู่ระบบเกินเวลาที่กำหนด".into());
        }
        if let Some(mut login) = child_to_stop {
            if login.child.try_wait().ok().flatten().is_none() {
                let _ = login.child.kill().await;
            }
            let _ = login.child.wait().await;
        }
        serde_json::to_value(status).map_err(|_| "อ่านสถานะ provider ไม่ได้".into())
    }

    pub async fn start_login(
        &self,
        provider: &str,
        root: &Path,
        _app: tauri::AppHandle,
    ) -> Result<serde_json::Value, String> {
        let provider_id = parse_provider_id(provider)?;
        let command = login_command(provider_id)?;
        let home = provider_home(root, provider)?;
        std::fs::create_dir_all(&home).map_err(|_| "สร้าง managed provider home ไม่ได้")?;
        self.roots
            .lock()
            .await
            .insert(provider_id, root.to_path_buf());
        self.failures.lock().await.remove(&provider_id);
        let mut logins = self.logins.lock().await;
        if let Some(existing) = logins.get_mut(&provider_id) {
            if existing
                .child
                .try_wait()
                .map_err(|_| "อ่านสถานะ login ไม่ได้")?
                .is_none()
            {
                return serde_json::to_value(ProviderStatus {
                    provider: provider_id,
                    state: ProviderState::Authenticating,
                    installed: true,
                    authenticated: false,
                    version: None,
                    message: "กำลังรอการยืนยันในเบราว์เซอร์".into(),
                    authentication_url: None,
                })
                .map_err(|_| "อ่านสถานะ provider ไม่ได้".into());
            }
            let _ = logins.remove(&provider_id);
        }
        let child = spawn_cli(command, &home, true)?;
        let started_at = Instant::now();
        logins.insert(provider_id, ManagedLogin { child, started_at });
        drop(logins);
        self.spawn_login_watchdog(provider_id, started_at);
        serde_json::to_value(ProviderStatus {
            provider: provider_id,
            state: ProviderState::Authenticating,
            installed: true,
            authenticated: false,
            version: None,
            message: "เบราว์เซอร์กำลังเปิดเพื่อเข้าสู่ระบบ".into(),
            authentication_url: None,
        })
        .map_err(|_| "อ่านสถานะ provider ไม่ได้".into())
    }

    pub async fn cancel_login(&self, provider: &str) -> Result<serde_json::Value, String> {
        let provider_id = parse_provider_id(provider)?;
        if provider_id == ProviderId::Ollama {
            return serde_json::to_value(ProviderStatus::blocked(
                provider_id,
                "Ollama ใช้บริการ local และไม่ต้องเข้าสู่ระบบ",
            ))
            .map_err(|_| "อ่านสถานะ provider ไม่ได้".into());
        }
        let login = self.logins.lock().await.remove(&provider_id);
        if let Some(mut login) = login {
            if login.child.try_wait().ok().flatten().is_none() {
                let _ = login.child.kill().await;
            }
            let _ = login.child.wait().await;
        }
        self.failures.lock().await.remove(&provider_id);
        let root = self.roots.lock().await.get(&provider_id).cloned();
        let Some(root) = root else {
            return serde_json::to_value(ProviderStatus {
                provider: provider_id,
                state: ProviderState::Failed,
                installed: false,
                authenticated: false,
                version: None,
                message: "ยังไม่มี managed provider home สำหรับตรวจสถานะ".into(),
                authentication_url: None,
            })
            .map_err(|_| "อ่านสถานะ provider ไม่ได้".into());
        };
        self.status(provider, &root).await
    }

    fn spawn_login_watchdog(&self, provider: ProviderId, started_at: Instant) {
        let logins = Arc::clone(&self.logins);
        let failures = Arc::clone(&self.failures);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(LOGIN_TIMEOUT_SECS)).await;
            let login = {
                let mut logins = logins.lock().await;
                let expired = logins
                    .get(&provider)
                    .map(|login| login.started_at)
                    .is_some_and(|current| login_generation_matches(Some(current), started_at));
                if expired {
                    logins.remove(&provider)
                } else {
                    None
                }
            };
            if let Some(mut login) = login {
                if login.child.try_wait().ok().flatten().is_none() {
                    let _ = login.child.kill().await;
                }
                let _ = login.child.wait().await;
                failures
                    .lock()
                    .await
                    .insert(provider, "การเข้าสู่ระบบเกินเวลาที่กำหนด".into());
            }
        });
    }
}

struct CliOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

enum ProviderCommandError {
    Missing,
    Timeout,
    Failed,
}

const MAX_CLI_OUTPUT: usize = 64 * 1024;
const LOGIN_TIMEOUT_SECS: u64 = 600;

fn login_generation_matches(current: Option<Instant>, expected: Instant) -> bool {
    current == Some(expected)
}

fn resolve_cli_program(program: &str) -> Result<PathBuf, String> {
    if !matches!(program, "codex" | "claude") {
        return Err("provider CLI is not allowed".into());
    }

    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            #[cfg(windows)]
            {
                candidates.push(directory.join(format!("{program}.exe")));
                if program == "claude" {
                    candidates.push(
                        directory
                            .join("node_modules")
                            .join("@anthropic-ai")
                            .join("claude-code")
                            .join("bin")
                            .join("claude.exe"),
                    );
                }
            }
            #[cfg(not(windows))]
            candidates.push(directory.join(program));
        }
    }
    #[cfg(windows)]
    {
        if program == "claude" {
            if let Some(userprofile) = env::var_os("USERPROFILE") {
                candidates.push(
                    PathBuf::from(userprofile)
                        .join(".local")
                        .join("bin")
                        .join("claude.exe"),
                );
            }
        }
        if program == "codex" {
            if let Some(localappdata) = env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(localappdata)
                        .join("Programs")
                        .join("OpenAI")
                        .join("Codex")
                        .join("bin")
                        .join("codex.exe"),
                );
            }
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| format!("ไม่พบ CLI ของ provider: {program}"))
}

fn base_cli_command(
    command: ProviderCommand,
    home: &Path,
    interactive: bool,
) -> Result<tokio::process::Command, String> {
    let executable = resolve_cli_program(command.program)?;
    let mut process = tokio::process::Command::new(executable);
    process
        .args(command.args)
        .current_dir(home)
        .env_clear()
        .env(command.home_env, home)
        .stdin(Stdio::null())
        .stdout(if interactive {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .stderr(if interactive {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .kill_on_drop(true);
    for key in [
        "PATH",
        "SystemRoot",
        "LOCALAPPDATA",
        "USERPROFILE",
        "TEMP",
        "TMP",
    ] {
        if let Some(value) = env::var_os(key) {
            process.env(key, value);
        }
    }
    #[cfg(windows)]
    process.creation_flags(0x08000000);
    Ok(process)
}

fn spawn_cli(
    command: ProviderCommand,
    home: &Path,
    interactive: bool,
) -> Result<tokio::process::Child, String> {
    base_cli_command(command, home, interactive)?
        .spawn()
        .map_err(|_| "ไม่พบ CLI ของ provider นี้".into())
}

async fn read_bounded<R>(mut reader: R) -> Result<Vec<u8>, ()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await.map_err(|_| ())?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > MAX_CLI_OUTPUT {
            return Err(());
        }
        output.extend_from_slice(&buffer[..read]);
    }
}

async fn run_cli(
    command: ProviderCommand,
    home: &Path,
    timeout: Duration,
) -> Result<CliOutput, ProviderCommandError> {
    let mut child = base_cli_command(command, home, false)
        .map_err(|_| ProviderCommandError::Missing)?
        .spawn()
        .map_err(|_| ProviderCommandError::Failed)?;
    let stdout = child.stdout.take().ok_or(ProviderCommandError::Failed)?;
    let stderr = child.stderr.take().ok_or(ProviderCommandError::Failed)?;
    let result = tokio::time::timeout(timeout, async {
        let stdout = read_bounded(stdout);
        let stderr = read_bounded(stderr);
        let wait = child.wait();
        let (stdout, stderr, status) = tokio::join!(stdout, stderr, wait);
        (stdout, stderr, status)
    })
    .await;
    match result {
        Ok((Ok(stdout), Ok(stderr), Ok(status))) => Ok(CliOutput {
            success: status.success(),
            stdout,
            stderr,
        }),
        Ok(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(ProviderCommandError::Failed)
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(ProviderCommandError::Timeout)
        }
    }
}

pub fn login_command(provider: ProviderId) -> Result<ProviderCommand, String> {
    match provider {
        ProviderId::Ollama => Err("Ollama ใช้บริการ local และไม่ต้องเข้าสู่ระบบ".into()),
        ProviderId::Codex => Ok(ProviderCommand {
            program: "codex",
            args: &["login", "-c", "cli_auth_credentials_store=\"keyring\""],
            home_env: "CODEX_HOME",
        }),
        ProviderId::Claude => Ok(ProviderCommand {
            program: "claude",
            args: &["auth", "login"],
            home_env: "CLAUDE_CONFIG_DIR",
        }),
    }
}

pub fn status_command(provider: ProviderId) -> Result<ProviderCommand, String> {
    match provider {
        ProviderId::Ollama => Err("Ollama ใช้การตรวจ /api/tags แทนสถานะ login".into()),
        ProviderId::Codex => Ok(ProviderCommand {
            program: "codex",
            args: &[
                "login",
                "status",
                "-c",
                "cli_auth_credentials_store=\"keyring\"",
            ],
            home_env: "CODEX_HOME",
        }),
        // The current CLI exposes an explicit auth status command. Unknown output stays FAILED.
        ProviderId::Claude => Ok(ProviderCommand {
            program: "claude",
            args: &["auth", "status", "--json"],
            home_env: "CLAUDE_CONFIG_DIR",
        }),
    }
}

fn version_command(provider: ProviderId) -> Result<ProviderCommand, String> {
    match provider {
        ProviderId::Ollama => Err("Ollama ใช้การค้นหา /api/tags แทนการตรวจ CLI".into()),
        ProviderId::Codex => Ok(ProviderCommand {
            program: "codex",
            args: &["--version"],
            home_env: "CODEX_HOME",
        }),
        ProviderId::Claude => Ok(ProviderCommand {
            program: "claude",
            args: &["--version"],
            home_env: "CLAUDE_CONFIG_DIR",
        }),
    }
}

/// Bounded native CLI diagnosis for the legacy Desktop check command. It reports installation
/// only; a version string never proves login or model access.
pub async fn diagnose_cli(provider: &str) -> Result<serde_json::Value, String> {
    let provider_id = parse_provider_id(provider)?;
    let command = version_command(provider_id)?;
    let home = tempfile::Builder::new()
        .prefix("zuri-edge-provider-check-")
        .tempdir()
        .map_err(|_| "สร้างโฟลเดอร์ตรวจ CLI ไม่ได้")?;
    let output = match run_cli(command, home.path(), Duration::from_secs(5)).await {
        Ok(output) => output,
        Err(ProviderCommandError::Missing) => return Err("ไม่พบ CLI ที่เลือกใน PATH".into()),
        Err(ProviderCommandError::Timeout) => return Err("ตรวจ CLI เกินเวลา".into()),
        Err(ProviderCommandError::Failed) => return Err("CLI ที่เลือกทำงานไม่สำเร็จ".into()),
    };
    if !output.success {
        return Err("CLI ที่เลือกทำงานไม่สำเร็จ".into());
    }
    let version =
        sanitize_version(&output.stdout, &output.stderr).ok_or("CLI ไม่ส่งเวอร์ชันที่ปลอดภัยกลับมา")?;
    serde_json::to_value(serde_json::json!({
        "success": true,
        "provider": provider_id,
        "installed": true,
        "authenticated": false,
        "version": version,
        "message": format!("พบ {} — ยังไม่ได้ตรวจสิทธิ์เรียกโมเดล", provider_id.as_str()),
    }))
    .map_err(|_| "อ่านผลตรวจ CLI ไม่ได้".into())
}

pub fn managed_home_env(provider: ProviderId, home: &Path) -> Result<(String, String), String> {
    if !home.is_absolute() {
        return Err("managed provider home must be an absolute path".into());
    }
    let value = home
        .to_str()
        .ok_or("managed provider home is not valid UTF-8")?;
    if value.is_empty() || value.chars().any(|c| c == '\r' || c == '\n' || c == '\0') {
        return Err("managed provider home is invalid".into());
    }
    let key = match provider {
        ProviderId::Ollama => return Err("Ollama has no CLI credential home".into()),
        ProviderId::Codex => "CODEX_HOME",
        ProviderId::Claude => "CLAUDE_CONFIG_DIR",
    };
    Ok((key.to_string(), value.to_string()))
}

pub fn validate_ollama_base_url(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() || candidate.len() > 256 {
        return Err("Ollama address is required".into());
    }
    let url = reqwest::Url::parse(candidate).map_err(|_| "Ollama address is invalid")?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.path() != "" && url.path() != "/")
        || !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1" | "[::1]")
    {
        return Err(
            "Ollama address must be an HTTP loopback origin without credentials or a path".into(),
        );
    }
    Ok(url.origin().ascii_serialization())
}

pub async fn discover_ollama_with_selection(
    base_url: &str,
    selected_model: Option<&str>,
) -> Result<OllamaDiscovery, String> {
    let base_url = validate_ollama_base_url(base_url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|_| "Ollama ตรวจสอบไม่ได้")?;
    let response = client
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .map_err(|_| "ติดต่อ Ollama ไม่สำเร็จ")?;
    if !response.status().is_success() {
        return Err("Ollama ไม่พร้อมให้ค้นหารุ่นโมเดล".into());
    }
    let mut body = Vec::new();
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "อ่านรายการโมเดล Ollama ไม่สำเร็จ")?
    {
        if body.len().saturating_add(chunk.len()) > 1_048_576 {
            return Err("รายการโมเดล Ollama ใหญ่เกินกำหนด".into());
        }
        body.extend_from_slice(&chunk);
    }
    let models = parse_ollama_tags(&body)?;
    let requested = selected_model.filter(|name| !name.is_empty());
    let selected_model = requested
        .filter(|name| models.iter().any(|model| model.name == *name))
        .map(ToOwned::to_owned);
    let message = if selected_model.is_some() {
        "Ollama พร้อมใช้งานและพบโมเดลที่เลือก".to_string()
    } else if requested.is_some() {
        "Ollama พร้อมใช้งาน แต่ไม่พบโมเดลที่เลือก".to_string()
    } else {
        "Ollama พร้อมใช้งาน กรุณาเลือกโมเดล".to_string()
    };
    Ok(OllamaDiscovery {
        base_url,
        available: true,
        models,
        selected_model,
        message,
    })
}

/// Tauri-facing discovery shape. The UI asks only for the base URL; model selection is persisted
/// separately and checked by the worker before it starts.
pub async fn discover_ollama(base_url: &str) -> Result<serde_json::Value, String> {
    let discovery = discover_ollama_with_selection(base_url, None).await?;
    serde_json::to_value(discovery).map_err(|_| "อ่านรายการโมเดล Ollama ไม่ได้".into())
}

pub fn parse_ollama_tags(body: &[u8]) -> Result<Vec<OllamaModel>, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "รายการโมเดล Ollama ไม่ถูกต้อง")?;
    let source_models = value
        .get("models")
        .and_then(serde_json::Value::as_array)
        .ok_or("รายการโมเดล Ollama ไม่ถูกต้อง")?;
    let mut seen = BTreeSet::new();
    let mut models = Vec::new();
    for model in source_models {
        let name = model
            .get("name")
            .and_then(serde_json::Value::as_str)
            .ok_or("รายการโมเดล Ollama มีชื่อไม่ถูกต้อง")?;
        if name.is_empty()
            || name.len() > 120
            || name.trim() != name
            || name.chars().any(|c| c.is_control())
        {
            return Err("รายการโมเดล Ollama มีชื่อไม่ถูกต้อง".into());
        }
        if seen.insert(name.to_string()) {
            models.push(OllamaModel {
                name: name.to_string(),
            });
        }
    }
    Ok(models)
}

pub fn classify_cli_status(
    provider: ProviderId,
    installed: bool,
    exit_success: bool,
    stdout: &[u8],
    stderr: &[u8],
) -> ProviderStatus {
    if provider == ProviderId::Ollama {
        return ProviderStatus::blocked(provider, "Ollama ใช้การค้นหา /api/tags แทน CLI auth");
    }
    if !installed {
        return ProviderStatus {
            provider,
            state: ProviderState::Missing,
            installed: false,
            authenticated: false,
            version: None,
            message: "ไม่พบ CLI ของ provider นี้".into(),
            authentication_url: None,
        };
    }
    if provider == ProviderId::Claude {
        let logged_in = serde_json::from_slice::<serde_json::Value>(stdout)
            .ok()
            .and_then(|value| value.get("loggedIn").and_then(serde_json::Value::as_bool));
        let state = match (exit_success, logged_in) {
            (true, Some(true)) => ProviderState::Ready,
            (true, Some(false)) => ProviderState::LoggedOut,
            _ => ProviderState::Failed,
        };
        return ProviderStatus {
            provider,
            state,
            installed: true,
            authenticated: state == ProviderState::Ready,
            version: None,
            message: match state {
                ProviderState::LoggedOut => "CLI รายงานว่ายังไม่ได้เข้าสู่ระบบ".into(),
                ProviderState::Ready => "CLI ยืนยันสถานะเข้าสู่ระบบแล้ว".into(),
                _ => "ตรวจสถานะ CLI ไม่สำเร็จหรือไม่รู้จักผลลัพธ์".into(),
            },
            authentication_url: None,
        };
    }
    let lower = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
    .to_ascii_lowercase();
    let logged_out = [
        "not logged in",
        "not authenticated",
        "logged out",
        "login required",
        "please run /login",
        "no credentials",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    let authenticated = !logged_out
        && [
            "logged in",
            "authenticated",
            "using chatgpt",
            "using claude",
            "account:",
        ]
        .iter()
        .any(|marker| lower.contains(marker));
    let state = if logged_out {
        ProviderState::LoggedOut
    } else if exit_success && authenticated {
        ProviderState::Ready
    } else {
        ProviderState::Failed
    };
    ProviderStatus {
        provider,
        state,
        installed: true,
        authenticated: state == ProviderState::Ready,
        version: None,
        message: match state {
            ProviderState::LoggedOut => "CLI รายงานว่ายังไม่ได้เข้าสู่ระบบ".into(),
            ProviderState::Ready => "CLI ยืนยันสถานะเข้าสู่ระบบแล้ว".into(),
            _ => "ตรวจสถานะ CLI ไม่สำเร็จหรือไม่รู้จักผลลัพธ์".into(),
        },
        authentication_url: None,
    }
}

pub fn sanitize_version(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(if stdout.is_empty() { stderr } else { stdout });
    let line = text.lines().next()?.trim();
    if line.is_empty() || line.len() > 120 {
        return None;
    }
    if !line.chars().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '(' | ')' | ':' | '/')
    }) {
        return None;
    }
    Some(line.to_string())
}

pub fn validate_authentication_url(provider: ProviderId, raw: &str) -> Result<String, String> {
    if provider == ProviderId::Ollama || raw.len() > 2048 || raw.chars().any(|c| c.is_control()) {
        return Err("provider authentication URL is not allowed".into());
    }
    let url =
        reqwest::Url::parse(raw.trim()).map_err(|_| "provider authentication URL is invalid")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("provider authentication URL is not allowed".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed = match provider {
        ProviderId::Codex => matches!(host.as_str(), "auth.openai.com" | "chatgpt.com"),
        ProviderId::Claude => matches!(
            host.as_str(),
            "claude.ai" | "console.anthropic.com" | "platform.claude.com" | "auth.anthropic.com"
        ),
        ProviderId::Ollama => false,
    };
    if !allowed {
        return Err("provider authentication URL is not allowed".into());
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn defaults_are_independent_and_cloud_is_off() {
        let settings = ProviderSettings::default();
        assert_eq!(settings.provider, "ollama");
        assert_eq!(settings.ollama_base_url, DEFAULT_OLLAMA_BASE_URL);
        assert!(settings.ollama_model.is_empty());
        assert!(settings.codex_model.is_empty());
        assert!(settings.claude_model.is_empty());
        assert!(!settings.allow_cloud);
    }

    #[test]
    fn selected_model_uses_selected_provider() {
        let settings = ProviderSettings {
            provider: "claude".into(),
            claude_model: "claude-sonnet".into(),
            codex_model: "gpt-5.6-luna".into(),
            ..ProviderSettings::default()
        };
        assert_eq!(settings.selected_model(), "claude-sonnet");
    }

    #[test]
    fn settings_require_the_selected_model_and_keep_cloud_explicit() {
        let mut settings = ProviderSettings::default();
        assert!(validate_settings(&settings).is_err());
        settings.ollama_model = "llama3.1:8b".into();
        assert!(validate_settings(&settings).is_ok());
        settings.provider = "codex".into();
        settings.codex_model = "gpt-5.6-luna".into();
        assert!(validate_settings(&settings).is_ok());
        settings.allow_cloud = true;
        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn commands_are_fixed_and_separate() {
        assert_eq!(
            login_command(ProviderId::Codex).unwrap().args,
            &["login", "-c", "cli_auth_credentials_store=\"keyring\""]
        );
        assert_eq!(
            status_command(ProviderId::Codex).unwrap().args,
            &[
                "login",
                "status",
                "-c",
                "cli_auth_credentials_store=\"keyring\""
            ]
        );
        assert_eq!(
            login_command(ProviderId::Claude).unwrap().args,
            &["auth", "login"]
        );
        assert_eq!(
            status_command(ProviderId::Claude).unwrap().args,
            &["auth", "status", "--json"]
        );
        assert!(login_command(ProviderId::Ollama).is_err());
    }

    #[test]
    fn managed_homes_are_absolute_and_provider_scoped() {
        assert!(managed_home_env(ProviderId::Codex, Path::new("relative")).is_err());
        assert!(managed_home_env(ProviderId::Ollama, &PathBuf::from("C:\\managed")).is_err());
        assert_eq!(
            managed_home_env(ProviderId::Claude, &PathBuf::from("C:\\managed\\claude")).unwrap(),
            ("CLAUDE_CONFIG_DIR".into(), "C:\\managed\\claude".into())
        );
    }

    #[test]
    fn loopback_url_rejects_remote_and_credentialed_origins() {
        assert_eq!(
            validate_ollama_base_url("http://127.0.0.1:11434/").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            validate_ollama_base_url("http://[::1]:11434/").unwrap(),
            "http://[::1]:11434"
        );
        assert!(validate_ollama_base_url("https://127.0.0.1:11434").is_err());
        assert!(validate_ollama_base_url("http://127.0.0.1:11434/v1").is_err());
        assert!(validate_ollama_base_url("http://user:pass@127.0.0.1:11434").is_err());
        assert!(validate_ollama_base_url("http://example.test:11434").is_err());
    }

    #[test]
    fn tags_are_bounded_and_deduplicated() {
        let models = parse_ollama_tags(
            br#"{"models":[{"name":"llama3.1:8b","size":123},{"name":"llama3.1:8b"},{"name":"qwen3:4b"}]}"#,
        )
        .unwrap();
        assert_eq!(
            models,
            vec![
                OllamaModel {
                    name: "llama3.1:8b".into()
                },
                OllamaModel {
                    name: "qwen3:4b".into()
                },
            ]
        );
        assert!(parse_ollama_tags(br#"[]"#).is_err());
        assert!(parse_ollama_tags(br#"{"models":[{"name":" llama3"}]}"#).is_err());
        assert!(parse_ollama_tags(
            format!(r#"{{"models":[{{"name":"{}"}}]}}"#, "x".repeat(121)).as_bytes()
        )
        .is_err());
    }

    #[test]
    fn installation_and_version_do_not_prove_auth() {
        let status = classify_cli_status(ProviderId::Codex, true, true, b"codex-cli 0.151.0", b"");
        assert_eq!(status.state, ProviderState::Failed);
        assert!(!status.authenticated);
        let status = classify_cli_status(ProviderId::Codex, true, false, b"Not logged in", b"");
        assert_eq!(status.state, ProviderState::LoggedOut);
        assert_eq!(
            sanitize_version(b"2.1.263 (Claude Code)\nsecret", b""),
            Some("2.1.263 (Claude Code)".into())
        );
    }

    #[test]
    fn recognized_auth_states_are_redacted() {
        let status = classify_cli_status(
            ProviderId::Codex,
            true,
            true,
            b"Logged in using ChatGPT",
            b"",
        );
        assert_eq!(status.state, ProviderState::Ready);
        assert!(status.authenticated);
        assert!(!serde_json::to_string(&status).unwrap().contains("ChatGPT"));
        let status = classify_cli_status(
            ProviderId::Claude,
            true,
            true,
            br#"{"loggedIn":false}"#,
            b"",
        );
        assert_eq!(status.state, ProviderState::LoggedOut);
        let status = classify_cli_status(
            ProviderId::Claude,
            true,
            true,
            br#"{"loggedIn":true,"email":"redacted"}"#,
            b"",
        );
        assert_eq!(status.state, ProviderState::Ready);
        let status = classify_cli_status(ProviderId::Claude, true, true, b"authenticated", b"");
        assert_eq!(status.state, ProviderState::Failed);
    }

    #[test]
    fn authentication_url_allowlist_is_provider_scoped() {
        assert!(
            validate_authentication_url(ProviderId::Codex, "https://auth.openai.com/oauth").is_ok()
        );
        assert!(validate_authentication_url(ProviderId::Claude, "https://claude.ai/login").is_ok());
        assert!(validate_authentication_url(ProviderId::Codex, "https://claude.ai/login").is_err());
        assert!(validate_authentication_url(ProviderId::Claude, "http://claude.ai/login").is_err());
        assert!(
            validate_authentication_url(ProviderId::Claude, "https://evil.example/login").is_err()
        );
    }

    #[test]
    fn provider_names_and_homes_are_explicit() {
        assert_eq!(parse_provider_id("codex").unwrap(), ProviderId::Codex);
        assert!(parse_provider_id("Codex").is_err());
        assert!(provider_home(Path::new("relative"), "codex").is_err());
    }

    #[tokio::test]
    async fn cancellation_reuses_desktop_root_without_rebasing_home() {
        let manager = ProviderManager::new();
        let desktop_root = tempfile::tempdir().unwrap();
        let desktop_root = desktop_root.path().to_path_buf();
        let expected_home = provider_home(&desktop_root, "codex").unwrap();
        manager
            .roots
            .lock()
            .await
            .insert(ProviderId::Codex, desktop_root.clone());
        let cancel_root = manager
            .roots
            .lock()
            .await
            .get(&ProviderId::Codex)
            .cloned()
            .unwrap();
        assert_eq!(provider_home(&cancel_root, "codex").unwrap(), expected_home);
        assert_ne!(
            provider_home(&expected_home, "codex").unwrap(),
            expected_home
        );
    }

    #[test]
    fn an_old_login_watchdog_cannot_match_a_new_generation() {
        let old_generation = Instant::now();
        let new_generation = old_generation + Duration::from_secs(1);
        assert!(login_generation_matches(
            Some(old_generation),
            old_generation
        ));
        assert!(!login_generation_matches(
            Some(new_generation),
            old_generation
        ));
    }
}
