// @spec FR-150-P2, EDGE-DESKTOP-TAURI-RUNTIME §§6-9 — supervised optional compute worker.
//
// This module owns only the fixed packaged Node child. It does not parse UI commands, choose an
// executable, or expose the device credential after start. The credential is placed in one
// initialize message on the child's private stdin; stdout is reduced to the bounded event set
// consumed by the Desktop status view.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader},
    process::{Child, ChildStdin, Command},
    sync::{watch, Mutex as AsyncMutex},
    time::{sleep, timeout},
};

const PROTOCOL_VERSION: u64 = 1;
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const EVENT_LINE_LIMIT: usize = 4096;
const MAX_PACKAGE_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_MANIFEST_ENTRIES: usize = 50_000;
const PINNED_NODE_VERSION: &str = "v24.19.0";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProviderSettings {
    pub llm_enabled: bool,
    pub llm_allow_cloud: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_effort: Option<String>,
    pub headless_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headless_bin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headless_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headless_max_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headless_timeout_ms: Option<u64>,
}

#[derive(Clone)]
pub struct ManagedWorkerConfig {
    pub device_id: String,
    pub cloud_base_url: String,
    /// Kept out of Debug/Serialize and written only to the child's private stdin.
    pub device_key: String,
    pub node_path: PathBuf,
    pub worker_entry: PathBuf,
    pub package_root: PathBuf,
    pub data_root: PathBuf,
    pub managed_provider_home: Option<PathBuf>,
    pub rag_url: Option<String>,
    pub poll_interval_ms: u64,
    pub heartbeat_interval_ms: u64,
    pub provider: ManagedProviderSettings,
}

impl ManagedWorkerConfig {
    /// Derive all executable/resource paths from the Desktop executable's package directory.
    /// Callers cannot provide a Node or worker path through the UI.
    pub fn from_package(
        package_root: impl Into<PathBuf>,
        data_root: PathBuf,
        device_id: String,
        cloud_base_url: String,
        device_key: String,
        managed_provider_home: Option<PathBuf>,
        rag_url: Option<String>,
        provider: ManagedProviderSettings,
    ) -> Result<Self, String> {
        let package_root = package_root.into();
        if !package_root.is_absolute() || !data_root.is_absolute() {
            return Err("PACKAGE_INVALID".into());
        }
        Ok(Self {
            node_path: package_root.join("runtime").join("node.exe"),
            worker_entry: package_root
                .join("worker")
                .join("dist")
                .join("desktop-worker.js"),
            package_root,
            data_root,
            device_id,
            cloud_base_url,
            device_key,
            managed_provider_home,
            rag_url,
            poll_interval_ms: 5000,
            heartbeat_interval_ms: 40000,
            provider,
        })
    }
}

struct ManagedProcess {
    child: Arc<AsyncMutex<Child>>,
    stdin: Arc<AsyncMutex<ChildStdin>>,
    event_tx: watch::Sender<Option<Value>>,
    #[cfg(windows)]
    job: WindowsJob,
}

struct Inner {
    process: Option<Arc<ManagedProcess>>,
    lock_path: Option<PathBuf>,
    lock_file: Option<File>,
    state: String,
    ready: bool,
    claim_accepted: bool,
    pid: Option<u32>,
    last_event: Option<Value>,
    last_heartbeat_at: Option<String>,
    failure: Option<String>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            process: None,
            lock_path: None,
            lock_file: None,
            state: "STOPPED".into(),
            ready: false,
            claim_accepted: false,
            pid: None,
            last_event: None,
            last_heartbeat_at: None,
            failure: None,
        }
    }
}

#[derive(Clone)]
pub struct Supervisor {
    inner: Arc<Mutex<Inner>>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }
}

impl Supervisor {
    pub fn snapshot(&self) -> Value {
        let inner = self.inner.lock().expect("supervisor state lock");
        snapshot_locked(&inner)
    }

    pub fn is_active(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.process.is_some() && inner.state != "STOPPED")
            .unwrap_or(false)
    }

    pub async fn start(&self, config: ManagedWorkerConfig) -> Result<Value, String> {
        {
            let inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
            if inner.process.is_some() {
                return Ok(snapshot_locked(&inner));
            }
        }
        validate_config(&config)?;
        verify_package(&config)?;
        fs::create_dir_all(&config.data_root).map_err(|_| "CONFIG_INVALID")?;
        let (lock_path, lock_file) = match acquire_lock(&config.data_root) {
            Ok(lock) => lock,
            Err(_) => {
                let mut inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
                inner.state = "EXTERNAL_UNVERIFIED".into();
                inner.failure = Some("EXTERNAL_UNVERIFIED".into());
                return Err("EXTERNAL_UNVERIFIED".into());
            }
        };

        let mut command = Command::new(&config.node_path);
        command
            .arg(&config.worker_entry)
            .current_dir(&config.data_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        apply_runtime_environment(&mut command, &config);
        #[cfg(windows)]
        command.creation_flags(0x08000000);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };
        let pid = match child.id() {
            Some(pid) => pid,
            None => {
                let _ = child.kill().await;
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.kill().await;
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill().await;
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let _ = child.kill().await;
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };
        #[cfg(windows)]
        let job = match WindowsJob::attach(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.start_kill();
                release_lock(&lock_path, lock_file);
                return Err("WORKER_FAILED".into());
            }
        };

        let (event_tx, mut ready_rx) = watch::channel(None);
        let process = Arc::new(ManagedProcess {
            child: Arc::new(AsyncMutex::new(child)),
            stdin: Arc::new(AsyncMutex::new(stdin)),
            event_tx,
            #[cfg(windows)]
            job,
        });
        {
            let mut inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
            inner.process = Some(process.clone());
            inner.lock_path = Some(lock_path);
            inner.lock_file = Some(lock_file);
            inner.state = "STARTING".into();
            inner.ready = false;
            inner.claim_accepted = false;
            inner.pid = Some(pid);
            inner.failure = None;
            inner.last_event = None;
        }

        let reader_supervisor = self.clone();
        let reader_process = process.clone();
        tokio::spawn(async move {
            read_worker_stdout(reader_supervisor, reader_process, stdout).await;
        });
        let stderr_process = process.clone();
        tokio::spawn(async move {
            drain_worker_stderr(stderr, stderr_process).await;
        });
        let monitor_supervisor = self.clone();
        let monitor_process = process.clone();
        tokio::spawn(async move {
            monitor_child(monitor_supervisor, monitor_process).await;
        });

        if send_json(&process.stdin, initialize_message(&config)?)
            .await
            .is_err()
        {
            let _ = self.stop().await;
            return Err("WORKER_FAILED".into());
        }

        let ready = timeout(READY_TIMEOUT, async {
            loop {
                let snapshot = self.snapshot();
                if snapshot["ready"].as_bool() == Some(true) {
                    return true;
                }
                if snapshot["failure"].is_string() {
                    return false;
                }
                if ready_rx.changed().await.is_err() {
                    return false;
                }
            }
        })
        .await
        .unwrap_or(false);
        if !ready {
            let _ = self.stop().await;
            let mut inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
            inner.state = "FAILED".into();
            inner.failure = Some("WORKER_FAILED".into());
            return Err("WORKER_FAILED".into());
        }
        Ok(self.snapshot())
    }

    pub async fn stop(&self) -> Result<Value, String> {
        let process = {
            let mut inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
            let Some(process) = inner.process.clone() else {
                inner.state = "STOPPED".into();
                inner.pid = None;
                return Ok(snapshot_locked(&inner));
            };
            inner.state = "STOPPING".into();
            process
        };
        let _ = send_json(&process.stdin, json!({"type":"stop","version":PROTOCOL_VERSION,"reason":"operator","deadlineMs":30000})).await;
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut exited = false;
        while Instant::now() < deadline {
            if child_exited(&process.child).await {
                exited = true;
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }
        if !exited {
            terminate_owned(&process).await;
            let _ = timeout(Duration::from_secs(2), async {
                while !child_exited(&process.child).await {
                    sleep(Duration::from_millis(20)).await;
                }
            })
            .await;
        }
        let lock = {
            let mut inner = self.inner.lock().map_err(|_| "WORKER_FAILED")?;
            inner.process = None;
            inner.state = "STOPPED".into();
            inner.ready = false;
            inner.claim_accepted = false;
            inner.pid = None;
            inner.lock_path.take().zip(inner.lock_file.take())
        };
        if let Some((path, file)) = lock {
            release_lock(&path, file);
        }
        Ok(self.snapshot())
    }

    pub async fn heartbeat(&self) -> Result<Value, String> {
        let process = self
            .inner
            .lock()
            .map_err(|_| "WORKER_FAILED")?
            .process
            .clone()
            .ok_or_else(|| "WORKER_NOT_RUNNING".to_string())?;
        send_json(
            &process.stdin,
            json!({"type":"heartbeat","version":PROTOCOL_VERSION}),
        )
        .await
        .map_err(|_| "HEARTBEAT_FAILED")?;
        Ok(json!({"sent":true,"state":self.snapshot()["state"]}))
    }
}

fn snapshot_locked(inner: &Inner) -> Value {
    json!({
        "active": inner.process.is_some(),
        "state": inner.state,
        "ready": inner.ready,
        "claimAccepted": inner.claim_accepted,
        "pid": inner.pid,
        "lastEvent": inner.last_event,
        "lastHeartbeatAt": inner.last_heartbeat_at,
        "failure": inner.failure,
    })
}

fn validate_config(config: &ManagedWorkerConfig) -> Result<(), String> {
    if config.device_id.is_empty()
        || config.device_id.len() > 120
        || config.device_id.chars().any(|c| c.is_control())
    {
        return Err("CONFIG_INVALID".into());
    }
    if !config.device_key.starts_with("edgk_")
        || config.device_key.len() < 20
        || config.device_key.len() > 200
    {
        return Err("CONFIG_INVALID".into());
    }
    let origin = reqwest::Url::parse(&config.cloud_base_url).map_err(|_| "CONFIG_INVALID")?;
    let loopback = matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(origin.scheme() == "https" || (origin.scheme() == "http" && loopback))
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err("CONFIG_INVALID".into());
    }
    if !config.package_root.is_absolute()
        || !config.data_root.is_absolute()
        || !config.node_path.is_absolute()
        || !config.worker_entry.is_absolute()
        || !config.node_path.starts_with(&config.package_root)
        || !config.worker_entry.starts_with(&config.package_root)
        || config.node_path != config.package_root.join("runtime/node.exe")
        || config.worker_entry != config.package_root.join("worker/dist/desktop-worker.js")
    {
        return Err("PACKAGE_INVALID".into());
    }
    if let Some(home) = &config.managed_provider_home {
        if !home.is_absolute() {
            return Err("CONFIG_INVALID".into());
        }
    }
    if config.poll_interval_ms == 0
        || config.poll_interval_ms > 30_000
        || config.heartbeat_interval_ms == 0
        || config.heartbeat_interval_ms > 120_000
    {
        return Err("CONFIG_INVALID".into());
    }
    Ok(())
}

fn acquire_lock(root: &Path) -> Result<(PathBuf, File), String> {
    let path = root.join(".zuri-desktop-worker.lock");
    #[cfg(windows)]
    let mut file = {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(0)
            .open(&path)
            .map_err(|_| "LOCK_BUSY")?
    };
    #[cfg(not(windows))]
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "LOCK_BUSY")?;
    let _ = writeln!(
        file,
        "{{\"pid\":{},\"startedAt\":{:?}}}",
        std::process::id(),
        chrono::Utc::now().to_rfc3339()
    );
    Ok((path, file))
}

fn release_lock(path: &Path, file: File) {
    drop(file);
    #[cfg(windows)]
    {
        // Keep the filename as the stable lock identity. CreateFile/share_mode(0) makes a
        // running owner observable while allowing a new owner to reopen the stale file after a
        // process crash; deleting it here would introduce a check/create race.
        let _ = path;
    }
    #[cfg(not(windows))]
    {
        let _ = fs::remove_file(path);
    }
}

fn initialize_message(config: &ManagedWorkerConfig) -> Result<Value, String> {
    let mut message = json!({
        "type":"initialize", "version":PROTOCOL_VERSION,
        "deviceId":config.device_id, "deviceKey":config.device_key,
        "cloudBaseUrl":config.cloud_base_url, "dataRoot":config.data_root,
        "ragUrl":config.rag_url, "pollIntervalMs":config.poll_interval_ms,
        "heartbeatIntervalMs":config.heartbeat_interval_ms,
        "provider":config.provider,
    });
    if let Some(home) = &config.managed_provider_home {
        message["managedProviderHome"] = Value::String(home.to_string_lossy().to_string());
    }
    Ok(message)
}

fn apply_runtime_environment(command: &mut Command, config: &ManagedWorkerConfig) {
    command.env_clear();
    for name in [
        "PATH",
        "Path",
        "PATHEXT",
        "COMSPEC",
        "SystemRoot",
        "windir",
        "TEMP",
        "TMP",
        "LOCALAPPDATA",
        "APPDATA",
        "USERPROFILE",
    ] {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command
        .env("NODE_ENV", "production")
        .env("ZURI_DESKTOP_MANAGED", "1")
        // The native supervisor owns the exclusive process lock for a managed child. A second
        // Node-side lock would survive a forced kill and make an otherwise owned restart stale.
        .env("ZURI_DESKTOP_NATIVE_LOCK", "1")
        .env("ZURI_CONFIG_SKIP_DOTENV", "1")
        .env("ZURI_LINE_TRANSPORT_OWNER", "SERVER")
        .env("ZURI_STACK_REPLY_ENABLED", "false")
        .env("ZURI_COMMAND_TRANSPORT", "zuri-api")
        .env("ZURI_DESKTOP_PACKAGE_ROOT", &config.package_root)
        .env("ZURI_DESKTOP_DATA_ROOT", &config.data_root)
        .env("ZURI_CLOUD_BASE_URL", &config.cloud_base_url)
        .env("ZURI_EDGE_DEVICE_KEY", "")
        .env("ZURI_EDGE_DEVICE_KEY_FILE", "")
        .env("ZURI_AGENT_DEVICE_TOKEN", "")
        .env("ZURI_AGENT_DEVICE_TOKEN_FILE", "")
        .env(
            "GENESIS_RAG_API_URL",
            config.rag_url.as_deref().unwrap_or("http://127.0.0.1:8888"),
        );
}

async fn send_json(stdin: &Arc<AsyncMutex<ChildStdin>>, value: Value) -> Result<(), ()> {
    let bytes = serde_json::to_vec(&value).map_err(|_| ())?;
    if bytes.len() > EVENT_LINE_LIMIT * 4 {
        return Err(());
    }
    let mut input = stdin.lock().await;
    input.write_all(&bytes).await.map_err(|_| ())?;
    input.write_all(b"\n").await.map_err(|_| ())?;
    input.flush().await.map_err(|_| ())
}

async fn read_worker_stdout(
    supervisor: Supervisor,
    process: Arc<ManagedProcess>,
    stdout: impl tokio::io::AsyncRead + Unpin,
) {
    let mut reader = AsyncBufReader::new(stdout);
    let mut line = Vec::with_capacity(EVENT_LINE_LIMIT + 1);
    loop {
        let valid = match read_bounded_line(&mut reader, &mut line).await {
            Ok(Some(valid)) => valid,
            Ok(None) | Err(_) => break,
        };
        if !valid {
            set_failure(&supervisor, &process, "WORKER_FAILED");
            terminate_owned(&process).await;
            break;
        }
        let Ok(line) = std::str::from_utf8(&line) else {
            continue;
        };
        let line = line.trim_end_matches('\n').trim_end_matches('\r');
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(event) = safe_event(&value) else {
            continue;
        };
        record_event(&supervisor, &process, &event);
        let _ = process.event_tx.send(Some(event));
    }
}

/// Read one line while keeping untrusted child output bounded. `read_line`/`lines` grow their
/// destination until a newline arrives, so a broken child could otherwise consume unbounded
/// memory before the length guard runs. The caller receives no partial oversized payload.
async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> std::io::Result<Option<bool>> {
    line.clear();
    let mut oversized = false;
    loop {
        let chunk = reader.fill_buf().await?;
        if chunk.is_empty() {
            if line.is_empty() && !oversized {
                return Ok(None);
            }
            return Ok(Some(!oversized && line.len() <= EVENT_LINE_LIMIT));
        }
        let newline = chunk.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(chunk.len(), |index| index + 1);
        if !oversized {
            if line.len().saturating_add(take) <= EVENT_LINE_LIMIT + 1 {
                line.extend_from_slice(&chunk[..take]);
            } else {
                oversized = true;
            }
        }
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some(!oversized));
        }
        if oversized {
            // Discard the remainder of the offending line without retaining it.
            loop {
                let chunk = reader.fill_buf().await?;
                if chunk.is_empty() {
                    return Ok(Some(false));
                }
                let newline = chunk.iter().position(|byte| *byte == b'\n');
                let take = newline.map_or(chunk.len(), |index| index + 1);
                reader.consume(take);
                if newline.is_some() {
                    return Ok(Some(false));
                }
            }
        }
    }
}

async fn drain_worker_stderr(
    mut stderr: impl tokio::io::AsyncRead + Unpin,
    _process: Arc<ManagedProcess>,
) {
    let mut buffer = [0u8; 1024];
    loop {
        match tokio::io::AsyncReadExt::read(&mut stderr, &mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}

async fn monitor_child(supervisor: Supervisor, process: Arc<ManagedProcess>) {
    loop {
        if child_exited(&process.child).await {
            let mut lock = None;
            let mut inner = match supervisor.inner.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner
                .process
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &process))
            {
                if inner.state != "STOPPING" && inner.state != "STOPPED" {
                    inner.state = "FAILED".into();
                    inner.failure = Some("WORKER_EXITED".into());
                }
                inner.process = None;
                inner.pid = None;
                lock = inner.lock_path.take().zip(inner.lock_file.take());
            }
            drop(inner);
            if let Some((path, file)) = lock {
                release_lock(&path, file);
            }
            return;
        }
        sleep(Duration::from_millis(100)).await;
    }
}

async fn child_exited(child: &Arc<AsyncMutex<Child>>) -> bool {
    child.lock().await.try_wait().ok().flatten().is_some()
}

async fn terminate_owned(process: &Arc<ManagedProcess>) {
    #[cfg(windows)]
    {
        let _ = process.job.terminate();
    }
    #[cfg(not(windows))]
    {
        let _ = process.child.lock().await.kill().await;
    }
}

fn set_failure(supervisor: &Supervisor, process: &Arc<ManagedProcess>, code: &str) {
    if let Ok(mut inner) = supervisor.inner.lock() {
        if inner
            .process
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, process))
        {
            inner.failure = Some(code.into());
            inner.state = "FAILED".into();
        }
    }
}

fn record_event(supervisor: &Supervisor, process: &Arc<ManagedProcess>, event: &Value) {
    if let Ok(mut inner) = supervisor.inner.lock() {
        if !inner
            .process
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, process))
        {
            return;
        }
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        inner.last_event = Some(event.clone());
        match event_type {
            "ready" => inner.ready = true,
            "claim" => match event.get("outcome").and_then(Value::as_str) {
                Some("idle" | "claimed" | "completed" | "failed" | "lease_expired") => {
                    inner.claim_accepted = true;
                    inner.state = "RUNNING".into();
                }
                Some("retrying" | "stale_lease") => {
                    inner.claim_accepted = false;
                    inner.state = "DEGRADED".into();
                }
                _ => {}
            },
            "heartbeat" => {
                if event.get("ok").and_then(Value::as_bool) == Some(true) {
                    if let Some(at) = event.get("at").and_then(Value::as_str) {
                        inner.last_heartbeat_at = Some(at.into());
                    }
                }
            }
            "failure" => {
                inner.failure = event.get("code").and_then(Value::as_str).map(str::to_owned);
                inner.state = "FAILED".into();
            }
            _ => {}
        }
    }
}

fn safe_event(value: &Value) -> Option<Value> {
    let version = value.get("version").and_then(Value::as_u64)?;
    if version != PROTOCOL_VERSION {
        return None;
    }
    match value.get("type").and_then(Value::as_str)? {
        "ready" => {
            Some(json!({"type":"ready","version":PROTOCOL_VERSION,"transportOwner":"SERVER"}))
        }
        "claim" => {
            let outcome = value.get("outcome").and_then(Value::as_str)?;
            if !matches!(
                outcome,
                "idle"
                    | "claimed"
                    | "completed"
                    | "failed"
                    | "lease_expired"
                    | "stale_lease"
                    | "retrying"
            ) {
                return None;
            }
            Some(json!({"type":"claim","version":PROTOCOL_VERSION,"outcome":outcome}))
        }
        "heartbeat" => {
            let ok = value.get("ok").and_then(Value::as_bool)?;
            let status = value
                .get("status")
                .and_then(Value::as_str)
                .filter(|status| matches!(*status, "healthy" | "degraded" | "unavailable"));
            Some(
                json!({"type":"heartbeat","version":PROTOCOL_VERSION,"ok":ok,"status":status,"at":value.get("at").and_then(Value::as_str).unwrap_or("")}),
            )
        }
        "stopping" => {
            let reason = value.get("reason").and_then(Value::as_str)?;
            if !matches!(reason, "operator" | "quit" | "parent" | "worker") {
                return None;
            }
            Some(json!({"type":"stopping","version":PROTOCOL_VERSION,"reason":reason}))
        }
        "stopped" => Some(
            json!({"type":"stopped","version":PROTOCOL_VERSION,"graceful":value.get("graceful").and_then(Value::as_bool).unwrap_or(false)}),
        ),
        "failure" => {
            let code = value.get("code").and_then(Value::as_str)?;
            if !matches!(
                code,
                "INVALID_INIT"
                    | "INVALID_MESSAGE"
                    | "CONFIG_INVALID"
                    | "LOCK_BUSY"
                    | "EXTERNAL_UNVERIFIED"
                    | "AUTH_FAILED"
                    | "CONTRACT_INCOMPATIBLE"
                    | "WORKER_FAILED"
                    | "HEARTBEAT_FAILED"
                    | "STOP_TIMEOUT"
            ) {
                return None;
            }
            Some(json!({"type":"failure","version":PROTOCOL_VERSION,"code":code}))
        }
        _ => None,
    }
}

fn verify_package(config: &ManagedWorkerConfig) -> Result<(), String> {
    let manifest_path = config.package_root.join("manifest.json");
    let manifest_file = File::open(&manifest_path).map_err(|_| "PACKAGE_INVALID")?;
    let mut bytes = Vec::new();
    manifest_file
        .take((MAX_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "PACKAGE_INVALID")?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("PACKAGE_INVALID".into());
    }
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| "PACKAGE_INVALID")?;
    if manifest.get("version").and_then(Value::as_u64) != Some(1)
        || manifest.get("nodeVersion").and_then(Value::as_str) != Some(PINNED_NODE_VERSION)
    {
        return Err("PACKAGE_INVALID".into());
    }
    let records = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or("PACKAGE_INVALID")?;
    if records.is_empty() || records.len() > MAX_MANIFEST_ENTRIES {
        return Err("PACKAGE_INVALID".into());
    }
    let root = fs::canonicalize(&config.package_root).map_err(|_| "PACKAGE_INVALID")?;
    let mut saw_node = false;
    let mut saw_worker = false;
    let mut seen = std::collections::HashSet::with_capacity(records.len());
    for record in records {
        let relative = record
            .get("path")
            .and_then(Value::as_str)
            .ok_or("PACKAGE_INVALID")?;
        let expected = record
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or("PACKAGE_INVALID")?
            .to_ascii_lowercase();
        if !safe_relative_path(relative)
            || expected.len() != 64
            || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !seen.insert(relative.to_owned())
        {
            return Err("PACKAGE_INVALID".into());
        }
        let file = root.join(relative);
        let canonical = fs::canonicalize(&file).map_err(|_| "PACKAGE_INVALID")?;
        if !canonical.starts_with(&root) {
            return Err("PACKAGE_INVALID".into());
        }
        let metadata = fs::metadata(&canonical).map_err(|_| "PACKAGE_INVALID")?;
        if !metadata.is_file() || metadata.len() > MAX_PACKAGE_FILE_BYTES {
            return Err("PACKAGE_INVALID".into());
        }
        if hash_file(&canonical).map_err(|_| "PACKAGE_INVALID")? != expected {
            return Err("PACKAGE_INVALID".into());
        }
        saw_node |= relative == "runtime/node.exe";
        saw_worker |= relative == "worker/dist/desktop-worker.js";
    }
    if !saw_node || !saw_worker {
        return Err("PACKAGE_INVALID".into());
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && !value.contains('\\')
        && !value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(windows)]
struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for WindowsJob {}
#[cfg(windows)]
unsafe impl Sync for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &Child) -> Result<Self, ()> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, HANDLE},
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        };
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(());
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let process_handle = child.raw_handle().ok_or(())? as HANDLE;
        let assigned = unsafe { AssignProcessToJobObject(handle, process_handle) };
        if set == 0 || assigned == 0 {
            unsafe {
                CloseHandle(handle);
            }
            return Err(());
        }
        Ok(Self { handle })
    }
    fn terminate(&self) -> Result<(), ()> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        let ok = unsafe { TerminateJobObject(self.handle, 1) };
        if ok == 0 {
            Err(())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_event_discards_raw_output_and_unknown_types() {
        let ready =
            safe_event(&json!({"type":"ready","version":1,"deviceKey":"edgk_secret"})).unwrap();
        assert_eq!(ready["type"], "ready");
        assert!(!ready.to_string().contains("edgk_secret"));
        assert!(safe_event(&json!({"type":"raw","version":1,"text":"question"})).is_none());
    }

    #[test]
    fn package_paths_are_fixed() {
        assert!(safe_relative_path("runtime/node.exe"));
        assert!(!safe_relative_path("../node.exe"));
        assert!(!safe_relative_path("C:/node.exe"));
        assert!(!safe_relative_path("worker\\dist\\desktop-worker.js"));
    }

    #[test]
    fn package_manifest_hashes_all_required_files() {
        let package = tempfile::tempdir().unwrap();
        let root = package.path();
        fs::create_dir_all(root.join("runtime")).unwrap();
        fs::create_dir_all(root.join("worker/dist")).unwrap();
        fs::write(root.join("runtime/node.exe"), b"synthetic-node").unwrap();
        fs::write(
            root.join("worker/dist/desktop-worker.js"),
            b"synthetic-worker",
        )
        .unwrap();
        let node_hash = hash_file(&root.join("runtime/node.exe")).unwrap();
        let worker_hash = hash_file(&root.join("worker/dist/desktop-worker.js")).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&json!({
                "version": 1,
                "nodeVersion": PINNED_NODE_VERSION,
                "files": [
                    {"path": "runtime/node.exe", "sha256": node_hash},
                    {"path": "worker/dist/desktop-worker.js", "sha256": worker_hash}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let config = ManagedWorkerConfig {
            device_id: "device".into(),
            cloud_base_url: "https://cloud.example".into(),
            device_key: "edgk_test_key_123456789".into(),
            node_path: root.join("runtime/node.exe"),
            worker_entry: root.join("worker/dist/desktop-worker.js"),
            package_root: root.to_path_buf(),
            data_root: root.join("runtime-data"),
            managed_provider_home: None,
            rag_url: None,
            poll_interval_ms: 5000,
            heartbeat_interval_ms: 40000,
            provider: ManagedProviderSettings {
                llm_enabled: false,
                llm_allow_cloud: false,
                llm_base_url: None,
                llm_model: None,
                llm_num_ctx: None,
                llm_effort: None,
                headless_enabled: false,
                headless_bin: None,
                headless_model: None,
                headless_max_turns: None,
                headless_timeout_ms: None,
            },
        };
        verify_package(&config).unwrap();
        fs::write(root.join("worker/dist/desktop-worker.js"), b"tampered").unwrap();
        assert_eq!(verify_package(&config), Err("PACKAGE_INVALID".into()));
    }

    #[test]
    fn provider_init_omits_optional_nulls() {
        let provider = ManagedProviderSettings {
            llm_enabled: false,
            llm_allow_cloud: false,
            llm_base_url: None,
            llm_model: None,
            llm_num_ctx: None,
            llm_effort: None,
            headless_enabled: false,
            headless_bin: None,
            headless_model: None,
            headless_max_turns: None,
            headless_timeout_ms: None,
        };
        let value = serde_json::to_value(provider).unwrap();
        assert!(value.get("llmBaseUrl").is_none());
        assert!(value.get("headlessBin").is_none());
    }

    #[tokio::test]
    async fn bounded_stdout_reader_rejects_oversized_lines() {
        let payload = format!(
            "{}\n{{\"type\":\"ready\",\"version\":1}}\n",
            "x".repeat(EVENT_LINE_LIMIT + 1)
        );
        let mut reader =
            AsyncBufReader::new(tokio::io::BufReader::new(std::io::Cursor::new(payload)));
        let mut line = Vec::new();
        assert_eq!(
            read_bounded_line(&mut reader, &mut line).await.unwrap(),
            Some(false)
        );
        assert_eq!(
            read_bounded_line(&mut reader, &mut line).await.unwrap(),
            Some(true)
        );
    }
}
