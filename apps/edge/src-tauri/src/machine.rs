// @spec FR-150, INVENTORY-FR-150-edge-desktop-ui §8 — bounded local hardware diagnostics.
//
// This module is deliberately read-only and local. It never receives a path or command from the
// browser, never sends the result over the network, and never includes account, credential or
// file inventory data. The Desktop owner registers `get_machine_inventory` in lib.rs.

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

const CACHE_WINDOW: Duration = Duration::from_millis(750);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);
const CIM_TIMEOUT: Duration = Duration::from_secs(6);
const NVIDIA_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_HELPER_OUTPUT: usize = 512 * 1024;
const MAX_TEXT_LENGTH: usize = 256;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InventoryStatus {
    Ready,
    Partial,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperatingSystemInfo {
    pub caption: Option<String>,
    pub version: Option<String>,
    pub architecture: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: Option<String>,
    pub physical_cores: Option<u32>,
    pub logical_processors: Option<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub installed_bytes: Option<u64>,
    pub os_visible_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: Option<String>,
    pub driver_version: Option<String>,
    pub dedicated_vram_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub drive_letter: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MachineInventory {
    pub captured_at: String,
    pub status: InventoryStatus,
    pub computer_name: Option<String>,
    pub os: OperatingSystemInfo,
    pub cpus: Vec<CpuInfo>,
    pub memory: MemoryInfo,
    pub gpus: Vec<GpuInfo>,
    pub volumes: Vec<VolumeInfo>,
    pub field_errors: BTreeMap<String, String>,
}

impl MachineInventory {
    fn empty(captured_at: String) -> Self {
        Self {
            captured_at,
            status: InventoryStatus::Unavailable,
            computer_name: None,
            os: OperatingSystemInfo {
                caption: None,
                version: None,
                architecture: None,
            },
            cpus: Vec::new(),
            memory: MemoryInfo {
                installed_bytes: None,
                os_visible_bytes: None,
            },
            gpus: Vec::new(),
            volumes: Vec::new(),
            field_errors: BTreeMap::new(),
        }
    }

    fn finalize(mut self) -> Self {
        let has_data = self.computer_name.is_some()
            || self.os.caption.is_some()
            || self.os.version.is_some()
            || self.os.architecture.is_some()
            || !self.cpus.is_empty()
            || self.memory.installed_bytes.is_some()
            || self.memory.os_visible_bytes.is_some()
            || !self.gpus.is_empty()
            || !self.volumes.is_empty();
        self.status = if self.field_errors.is_empty() {
            InventoryStatus::Ready
        } else if has_data {
            InventoryStatus::Partial
        } else {
            InventoryStatus::Unavailable
        };
        self
    }
}

#[derive(Clone)]
struct CachedInventory {
    captured: Instant,
    value: MachineInventory,
}

static INVENTORY_CACHE: OnceLock<tokio::sync::Mutex<Option<CachedInventory>>> = OnceLock::new();

/// No-argument native IPC command. Overlapping calls share one bounded probe and a short-lived
/// snapshot, so tab navigation does not create a second PowerShell or GPU helper process.
#[tauri::command]
pub async fn get_machine_inventory() -> Result<MachineInventory, String> {
    let cache = INVENTORY_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut cached = cache.lock().await;
    if let Some(entry) = cached.as_ref() {
        if entry.captured.elapsed() <= CACHE_WINDOW {
            return Ok(entry.value.clone());
        }
    }
    let value = tokio::task::spawn_blocking(collect_machine_inventory)
        .await
        .map_err(|_| "อ่านข้อมูลเครื่องไม่สำเร็จ".to_string())?;
    *cached = Some(CachedInventory {
        captured: Instant::now(),
        value: value.clone(),
    });
    Ok(value)
}

fn capture_time() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(not(windows))]
fn unsupported_inventory() -> MachineInventory {
    let mut inventory = MachineInventory::empty(capture_time());
    for field in [
        "computerName",
        "os",
        "cpus",
        "memory.installedBytes",
        "memory.osVisibleBytes",
        "gpus",
        "volumes",
    ] {
        inventory
            .field_errors
            .insert(field.into(), "UNSUPPORTED_PLATFORM".into());
    }
    inventory
}

fn collect_machine_inventory() -> MachineInventory {
    #[cfg(windows)]
    {
        return collect_windows_inventory(TOTAL_TIMEOUT);
    }
    #[cfg(not(windows))]
    {
        unsupported_inventory()
    }
}

#[derive(Clone, Copy, Debug)]
enum ProbeError {
    Unavailable,
    Parse,
    Permission,
}

impl ProbeError {
    fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "UNAVAILABLE",
            Self::Parse => "PARSE_ERROR",
            Self::Permission => "PERMISSION_DENIED",
        }
    }
}

#[cfg(windows)]
const CIM_SCRIPT: &str = r#"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

# Each CIM class is isolated so one unavailable provider does not erase the sections that
# succeeded. Errors contain only allowlisted safe codes; exception text is never emitted.
$result = [ordered]@{
  computerName = $null
  os = [ordered]@{ caption = $null; version = $null; architecture = $null }
  cpus = @()
  memory = [ordered]@{ installedBytes = $null; osVisibleBytes = $null }
  gpus = @()
  volumes = @()
  fieldErrors = [ordered]@{}
}

function Emit-Snapshot {
  $result | ConvertTo-Json -Compress -Depth 8
}

Emit-Snapshot

try {
  $computer = Get-CimInstance -ClassName Win32_ComputerSystem -Property Name, TotalPhysicalMemory -ErrorAction Stop
  $result.computerName = $computer.Name
  $result.memory.osVisibleBytes = $computer.TotalPhysicalMemory
} catch {
  $result.fieldErrors['computerName'] = 'UNAVAILABLE'
  $result.fieldErrors['memory.osVisibleBytes'] = 'UNAVAILABLE'
}
Emit-Snapshot

try {
  $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption, Version, OSArchitecture -ErrorAction Stop
  $result.os = [ordered]@{
    caption = $operatingSystem.Caption
    version = $operatingSystem.Version
    architecture = $operatingSystem.OSArchitecture
  }
} catch {
  $result.fieldErrors['os'] = 'UNAVAILABLE'
}
Emit-Snapshot

try {
  $result.cpus = @(Get-CimInstance -ClassName Win32_Processor -Property Name, NumberOfCores, NumberOfLogicalProcessors -ErrorAction Stop | ForEach-Object {
    [ordered]@{
      name = $_.Name
      physicalCores = $_.NumberOfCores
      logicalProcessors = $_.NumberOfLogicalProcessors
    }
  })
} catch {
  $result.fieldErrors['cpus'] = 'UNAVAILABLE'
}
Emit-Snapshot

try {
  $physical = @(Get-CimInstance -ClassName Win32_PhysicalMemory -Property Capacity -ErrorAction Stop)
  $installed = $null
  foreach ($module in $physical) {
    if ($null -ne $module.Capacity) {
      if ($null -eq $installed) {
        $installed = [UInt64]$module.Capacity
      } else {
        $installed += [UInt64]$module.Capacity
      }
    }
  }
  $result.memory.installedBytes = $installed
  if ($null -eq $installed) {
    $result.fieldErrors['memory.installedBytes'] = 'UNAVAILABLE'
  }
} catch {
  $result.fieldErrors['memory.installedBytes'] = 'UNAVAILABLE'
}
Emit-Snapshot

try {
  $result.gpus = @(Get-CimInstance -ClassName Win32_VideoController -Property Name, DriverVersion -ErrorAction Stop | ForEach-Object {
    [ordered]@{ name = $_.Name; driverVersion = $_.DriverVersion }
  })
} catch {
  $result.fieldErrors['gpus'] = 'UNAVAILABLE'
}
Emit-Snapshot

try {
  $result.volumes = @(Get-CimInstance -ClassName Win32_LogicalDisk -Property DeviceID, Size, FreeSpace -Filter "DriveType=3" -ErrorAction Stop | ForEach-Object {
    [ordered]@{ driveLetter = $_.DeviceID; totalBytes = $_.Size; freeBytes = $_.FreeSpace }
  })
} catch {
  $result.fieldErrors['volumes'] = 'UNAVAILABLE'
}
Emit-Snapshot
"#;

#[cfg(windows)]
const NVIDIA_ARGS: &[&str] = &[
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
];

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessStatus {
    Success,
    TimedOut,
    Failed,
}

#[cfg(windows)]
#[derive(Debug)]
struct FixedProcessOutput {
    stdout: String,
    status: ProcessStatus,
    output_limited: bool,
}

#[cfg(windows)]
fn process_error_code(output: &FixedProcessOutput) -> Option<&'static str> {
    if output.status == ProcessStatus::TimedOut {
        Some("TIMEOUT")
    } else if output.output_limited {
        Some("PARSE_ERROR")
    } else if output.status == ProcessStatus::Failed {
        Some("UNAVAILABLE")
    } else {
        None
    }
}

#[cfg(windows)]
fn collect_windows_inventory(total_timeout: Duration) -> MachineInventory {
    let captured_at = capture_time();
    let started = Instant::now();
    let mut inventory = MachineInventory::empty(captured_at);
    let remaining = || total_timeout.saturating_sub(started.elapsed());
    let cim_timeout = remaining().min(CIM_TIMEOUT);
    let cim_result = powershell_path()
        .ok_or(ProbeError::Unavailable)
        .and_then(|path| {
            run_fixed_process(
                &path,
                &[
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    CIM_SCRIPT,
                ],
                cim_timeout,
            )
        });
    match cim_result {
        Ok(output) => match parse_latest_probe_json(&output.stdout) {
            Ok(mut parsed) => {
                parsed.captured_at = inventory.captured_at.clone();
                inventory = parsed.finalize();
                if let Some(code) = process_error_code(&output) {
                    add_probe_error(&mut inventory, "probe", code);
                }
                if !inventory.gpus.is_empty() && remaining() > Duration::ZERO {
                    match nvidia_smi_path()
                        .ok_or(ProbeError::Unavailable)
                        .and_then(|path| {
                            run_fixed_process(&path, NVIDIA_ARGS, remaining().min(NVIDIA_TIMEOUT))
                        }) {
                        Ok(output) if output.status == ProcessStatus::Success => {
                            let records = parse_nvidia_smi(&output.stdout);
                            attach_vram(&mut inventory, &records);
                            if let Some(code) = process_error_code(&output) {
                                add_probe_error(&mut inventory, "probe", code);
                            }
                        }
                        Ok(output) => {
                            let code = process_error_code(&output).unwrap_or("UNAVAILABLE");
                            for index in 0..inventory.gpus.len() {
                                inventory
                                    .field_errors
                                    .entry(format!("gpus[{index}].dedicatedVramBytes"))
                                    .or_insert_with(|| code.into());
                            }
                        }
                        Err(error) => {
                            for index in 0..inventory.gpus.len() {
                                inventory
                                    .field_errors
                                    .entry(format!("gpus[{index}].dedicatedVramBytes"))
                                    .or_insert_with(|| error.code().into());
                            }
                        }
                    }
                }
            }
            Err(error) => {
                if let Some(code) = process_error_code(&output) {
                    add_probe_error(&mut inventory, "probe", code);
                } else {
                    add_probe_error(&mut inventory, "probe", error.code());
                }
            }
        },
        Err(error) => add_probe_error(&mut inventory, "probe", error.code()),
    }
    inventory.finalize()
}

#[cfg(windows)]
fn powershell_path() -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot")?;
    let path = PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    path.is_file().then_some(path)
}

#[cfg(windows)]
fn nvidia_smi_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = std::env::var_os("SystemRoot") {
        candidates.push(PathBuf::from(root).join("System32/nvidia-smi.exe"));
    }
    if let Some(root) =
        std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles"))
    {
        candidates.push(PathBuf::from(root).join("NVIDIA Corporation/NVSMI/nvidia-smi.exe"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
fn run_fixed_process(
    path: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<FixedProcessOutput, ProbeError> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            ProbeError::Permission
        } else {
            ProbeError::Unavailable
        }
    })?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ProbeError::Unavailable);
        }
    };
    let reader = thread::spawn(move || read_bounded(stdout));
    let started = Instant::now();
    let mut exit_success = None;
    let mut wait_failed = false;
    let timed_out = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_success = Some(status.success());
                break false;
            }
            Ok(None) if started.elapsed() >= timeout => break true,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                wait_failed = true;
                break false;
            }
        }
    };
    if timed_out || wait_failed {
        let _ = child.kill();
        match child.wait() {
            Ok(status) => exit_success = Some(status.success()),
            Err(_) => wait_failed = true,
        }
    }
    let (bytes, output_limited) = reader.join().unwrap_or((Vec::new(), true));
    let status = if timed_out {
        ProcessStatus::TimedOut
    } else if wait_failed || exit_success != Some(true) {
        ProcessStatus::Failed
    } else {
        ProcessStatus::Success
    };
    Ok(FixedProcessOutput {
        stdout: String::from_utf8_lossy(&bytes).into_owned(),
        status,
        output_limited,
    })
}

#[cfg(windows)]
fn read_bounded(mut reader: impl Read) -> (Vec<u8>, bool) {
    let mut output = Vec::with_capacity(16 * 1024);
    let mut limited = false;
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                if output.len() < MAX_HELPER_OUTPUT {
                    let remaining = MAX_HELPER_OUTPUT - output.len();
                    output.extend_from_slice(&buffer[..read.min(remaining)]);
                    if read > remaining {
                        limited = true;
                    }
                } else {
                    limited = true;
                }
            }
        }
    }
    (output, limited)
}

fn add_probe_error(inventory: &mut MachineInventory, field: &str, code: &str) {
    inventory.field_errors.insert(field.into(), code.into());
}

fn is_safe_error_code(code: &str) -> bool {
    matches!(
        code,
        "UNAVAILABLE"
            | "TIMEOUT"
            | "PARSE_ERROR"
            | "PERMISSION_DENIED"
            | "NOT_TRUSTWORTHY"
            | "UNSUPPORTED_PLATFORM"
    )
}

fn is_probe_error_field(field: &str) -> bool {
    matches!(
        field,
        "computerName"
            | "os"
            | "cpus"
            | "probe"
            | "memory"
            | "memory.installedBytes"
            | "memory.osVisibleBytes"
            | "gpus"
            | "volumes"
    )
}

#[cfg(windows)]
fn parse_latest_probe_json(input: &str) -> Result<MachineInventory, ProbeError> {
    input
        .lines()
        .filter_map(|line| parse_probe_json(line).ok())
        .last()
        .ok_or(ProbeError::Parse)
}

fn parse_probe_json(input: &str) -> Result<MachineInventory, ProbeError> {
    let value: Value = serde_json::from_str(input).map_err(|_| ProbeError::Parse)?;
    let object = value.as_object().ok_or(ProbeError::Parse)?;
    let mut inventory = MachineInventory::empty(capture_time());

    if let Some(probe_errors) = object.get("fieldErrors").and_then(Value::as_object) {
        for (field, code) in probe_errors {
            if let Some(code) = code.as_str() {
                if is_safe_error_code(code) && is_probe_error_field(field) {
                    inventory
                        .field_errors
                        .entry(field.clone())
                        .or_insert_with(|| code.to_owned());
                }
            }
        }
    }

    inventory.computer_name = optional_text(
        object.get("computerName"),
        "computerName",
        &mut inventory.field_errors,
    );
    let os = object.get("os").and_then(Value::as_object);
    if os.is_none() {
        add_probe_error(&mut inventory, "os", "UNAVAILABLE");
    }
    inventory.os = OperatingSystemInfo {
        caption: optional_text(
            os.and_then(|value| value.get("caption")),
            "os.caption",
            &mut inventory.field_errors,
        ),
        version: optional_text(
            os.and_then(|value| value.get("version")),
            "os.version",
            &mut inventory.field_errors,
        ),
        architecture: optional_text(
            os.and_then(|value| value.get("architecture")),
            "os.architecture",
            &mut inventory.field_errors,
        ),
    };

    for (index, item) in array_items(object.get("cpus"), "cpus", &mut inventory.field_errors)
        .into_iter()
        .enumerate()
    {
        let Some(item) = item.as_object() else {
            add_probe_error(&mut inventory, &format!("cpus[{index}]"), "PARSE_ERROR");
            continue;
        };
        inventory.cpus.push(CpuInfo {
            name: optional_text(
                item.get("name"),
                &format!("cpus[{index}].name"),
                &mut inventory.field_errors,
            ),
            physical_cores: optional_u32(
                item.get("physicalCores"),
                &format!("cpus[{index}].physicalCores"),
                &mut inventory.field_errors,
            ),
            logical_processors: optional_u32(
                item.get("logicalProcessors"),
                &format!("cpus[{index}].logicalProcessors"),
                &mut inventory.field_errors,
            ),
        });
    }

    let memory = object.get("memory").and_then(Value::as_object);
    if memory.is_none() {
        add_probe_error(&mut inventory, "memory", "UNAVAILABLE");
    }
    inventory.memory = MemoryInfo {
        installed_bytes: optional_u64(
            memory.and_then(|value| value.get("installedBytes")),
            "memory.installedBytes",
            &mut inventory.field_errors,
        ),
        os_visible_bytes: optional_u64(
            memory.and_then(|value| value.get("osVisibleBytes")),
            "memory.osVisibleBytes",
            &mut inventory.field_errors,
        ),
    };

    for (index, item) in array_items(object.get("gpus"), "gpus", &mut inventory.field_errors)
        .into_iter()
        .enumerate()
    {
        let Some(item) = item.as_object() else {
            add_probe_error(&mut inventory, &format!("gpus[{index}]"), "PARSE_ERROR");
            continue;
        };
        inventory.gpus.push(GpuInfo {
            name: optional_text(
                item.get("name"),
                &format!("gpus[{index}].name"),
                &mut inventory.field_errors,
            ),
            driver_version: optional_text(
                item.get("driverVersion"),
                &format!("gpus[{index}].driverVersion"),
                &mut inventory.field_errors,
            ),
            dedicated_vram_bytes: None,
        });
    }

    for (index, item) in array_items(
        object.get("volumes"),
        "volumes",
        &mut inventory.field_errors,
    )
    .into_iter()
    .enumerate()
    {
        let Some(item) = item.as_object() else {
            add_probe_error(&mut inventory, &format!("volumes[{index}]"), "PARSE_ERROR");
            continue;
        };
        inventory.volumes.push(VolumeInfo {
            drive_letter: optional_text(
                item.get("driveLetter"),
                &format!("volumes[{index}].driveLetter"),
                &mut inventory.field_errors,
            ),
            total_bytes: optional_u64(
                item.get("totalBytes"),
                &format!("volumes[{index}].totalBytes"),
                &mut inventory.field_errors,
            ),
            free_bytes: optional_u64(
                item.get("freeBytes"),
                &format!("volumes[{index}].freeBytes"),
                &mut inventory.field_errors,
            ),
        });
    }
    Ok(inventory.finalize())
}

fn array_items(
    value: Option<&Value>,
    field: &str,
    errors: &mut BTreeMap<String, String>,
) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(_)) => vec![value.cloned().unwrap_or(Value::Null)],
        Some(Value::Null) | None => {
            errors
                .entry(field.into())
                .or_insert_with(|| "UNAVAILABLE".into());
            Vec::new()
        }
        Some(_) => {
            errors.insert(field.into(), "PARSE_ERROR".into());
            Vec::new()
        }
    }
}

fn optional_text(
    value: Option<&Value>,
    field: &str,
    errors: &mut BTreeMap<String, String>,
) -> Option<String> {
    match value {
        Some(Value::String(value)) => {
            let value = value.trim();
            if value.is_empty() || value.chars().any(char::is_control) {
                errors.insert(field.into(), "PARSE_ERROR".into());
                None
            } else {
                Some(value.chars().take(MAX_TEXT_LENGTH).collect())
            }
        }
        Some(Value::Null) | None => {
            errors
                .entry(field.into())
                .or_insert_with(|| "UNAVAILABLE".into());
            None
        }
        Some(_) => {
            errors.insert(field.into(), "PARSE_ERROR".into());
            None
        }
    }
}

fn optional_u64(
    value: Option<&Value>,
    field: &str,
    errors: &mut BTreeMap<String, String>,
) -> Option<u64> {
    match value.and_then(Value::as_u64) {
        Some(value) => Some(value),
        None if matches!(value, Some(Value::Null) | None) => {
            errors
                .entry(field.into())
                .or_insert_with(|| "UNAVAILABLE".into());
            None
        }
        None => {
            errors.insert(field.into(), "PARSE_ERROR".into());
            None
        }
    }
}

fn optional_u32(
    value: Option<&Value>,
    field: &str,
    errors: &mut BTreeMap<String, String>,
) -> Option<u32> {
    optional_u64(value, field, errors).and_then(|value| {
        if value <= u32::MAX as u64 {
            Some(value as u32)
        } else {
            errors.insert(field.into(), "PARSE_ERROR".into());
            None
        }
    })
}

#[derive(Clone, Debug, PartialEq)]
struct NvidiaRecord {
    name: String,
    memory_bytes: Option<u64>,
}

fn parse_nvidia_smi(input: &str) -> Vec<NvidiaRecord> {
    input
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.splitn(3, ',').map(str::trim).collect();
            if fields.len() != 3 || fields[0].is_empty() {
                return None;
            }
            let memory_bytes = fields[1]
                .parse::<u64>()
                .ok()
                .map(|mib| mib.saturating_mul(1024 * 1024));
            let _driver_version = fields[2];
            Some(NvidiaRecord {
                name: fields[0].to_string(),
                memory_bytes,
            })
        })
        .collect()
}

fn normalized_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn attach_vram(inventory: &mut MachineInventory, records: &[NvidiaRecord]) {
    let mut gpu_counts = HashMap::<String, usize>::new();
    let mut record_counts = HashMap::<String, usize>::new();
    for gpu in &inventory.gpus {
        if let Some(name) = gpu.name.as_deref() {
            *gpu_counts.entry(normalized_name(name)).or_default() += 1;
        }
    }
    for record in records {
        *record_counts
            .entry(normalized_name(&record.name))
            .or_default() += 1;
    }
    for (index, gpu) in inventory.gpus.iter_mut().enumerate() {
        let Some(name) = gpu.name.as_deref() else {
            inventory
                .field_errors
                .entry(format!("gpus[{index}].dedicatedVramBytes"))
                .or_insert_with(|| "NOT_TRUSTWORTHY".into());
            continue;
        };
        let key = normalized_name(name);
        let matches: Vec<_> = records
            .iter()
            .filter(|record| normalized_name(&record.name) == key)
            .collect();
        if gpu_counts.get(&key) == Some(&1)
            && record_counts.get(&key) == Some(&1)
            && matches.len() == 1
        {
            if let Some(bytes) = matches[0].memory_bytes {
                gpu.dedicated_vram_bytes = Some(bytes);
                continue;
            }
        }
        inventory
            .field_errors
            .entry(format!("gpus[{index}].dedicatedVramBytes"))
            .or_insert_with(|| "NOT_TRUSTWORTHY".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROBE: &str = r#"{
      "computerName":"SYNTHETIC-DESKTOP",
      "os":{"caption":"Windows Synthetic","version":"10.0","architecture":"64-bit"},
      "cpus":[{"name":"Synthetic CPU","physicalCores":8,"logicalProcessors":16}],
      "memory":{"installedBytes":17179869184,"osVisibleBytes":17175674880},
      "gpus":[
        {"name":"Synthetic GPU A","driverVersion":"1.2"},
        {"name":"Synthetic GPU B","driverVersion":"2.3"}
      ],
      "volumes":[{"driveLetter":"C:","totalBytes":1000,"freeBytes":400}]
    }"#;

    #[test]
    fn parses_multiple_records_and_keeps_numeric_bytes() {
        let value = parse_probe_json(PROBE).unwrap();
        assert_eq!(value.computer_name.as_deref(), Some("SYNTHETIC-DESKTOP"));
        assert_eq!(value.cpus.len(), 1);
        assert_eq!(value.gpus.len(), 2);
        assert_eq!(value.memory.installed_bytes, Some(17_179_869_184));
        assert_eq!(value.volumes[0].drive_letter.as_deref(), Some("C:"));
    }

    #[test]
    fn malformed_fields_become_partial_safe_errors() {
        let value = parse_probe_json(r#"{"computerName":7,"memory":{"installedBytes":"huge"},"gpus":[{"name":7}],"volumes":[]}"#).unwrap();
        assert_eq!(value.status, InventoryStatus::Partial);
        assert_eq!(value.field_errors["computerName"], "PARSE_ERROR");
        assert_eq!(value.field_errors["memory.installedBytes"], "PARSE_ERROR");
        assert_eq!(value.field_errors["gpus[0].name"], "PARSE_ERROR");
    }

    #[test]
    fn probe_section_errors_are_allowlisted_and_preserve_partial_data() {
        let value = parse_probe_json(
            r#"{
              "computerName":"SYNTHETIC-DESKTOP",
              "os":{"caption":"Windows Synthetic","version":null,"architecture":"64-bit"},
              "cpus":[],
              "memory":{"installedBytes":null,"osVisibleBytes":17175674880},
              "gpus":[],
              "volumes":[],
              "fieldErrors":{
                "memory.installedBytes":"UNAVAILABLE",
                "gpus":"UNAVAILABLE",
                "secret":"DO_NOT_COPY"
              }
            }"#,
        )
        .unwrap();
        assert_eq!(value.status, InventoryStatus::Partial);
        assert_eq!(value.field_errors["memory.installedBytes"], "UNAVAILABLE");
        assert_eq!(value.field_errors["gpus"], "UNAVAILABLE");
        assert!(!value.field_errors.contains_key("secret"));
    }

    #[test]
    fn malformed_root_is_unavailable_without_raw_error_text() {
        let error = parse_probe_json("not-json").unwrap_err();
        assert_eq!(error.code(), "PARSE_ERROR");
    }

    #[test]
    fn nvidia_vram_over_four_gib_is_parsed_from_trusted_source() {
        let records = parse_nvidia_smi("Synthetic GPU A, 5120, 555.1\n");
        assert_eq!(records[0].memory_bytes, Some(5 * 1024 * 1024 * 1024));
    }

    #[test]
    fn duplicate_adapter_names_never_guess_vram_pairing() {
        let mut value =
            parse_probe_json(r#"{"gpus":[{"name":"Same GPU"},{"name":"Same GPU"}]}"#).unwrap();
        let records = parse_nvidia_smi("Same GPU, 8192, 555.1\n");
        attach_vram(&mut value, &records);
        assert!(value
            .gpus
            .iter()
            .all(|gpu| gpu.dedicated_vram_bytes.is_none()));
        assert_eq!(
            value.field_errors["gpus[0].dedicatedVramBytes"],
            "NOT_TRUSTWORTHY"
        );
        assert_eq!(
            value.field_errors["gpus[1].dedicatedVramBytes"],
            "NOT_TRUSTWORTHY"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn overlapping_requests_share_one_cached_snapshot() {
        let (left, right) = tokio::join!(get_machine_inventory(), get_machine_inventory());
        let left = left.unwrap();
        let right = right.unwrap();
        assert_eq!(left.captured_at, right.captured_at);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires a Windows CIM provider; run explicitly on the target host"]
    fn actual_windows_probe_is_local_bounded_and_allowlisted() {
        let expected_name = std::env::var("COMPUTERNAME").expect("Windows test host name");
        let started = Instant::now();
        let value = collect_windows_inventory(TOTAL_TIMEOUT);
        assert!(started.elapsed() <= TOTAL_TIMEOUT + Duration::from_secs(2));
        assert!(matches!(
            value.status,
            InventoryStatus::Ready | InventoryStatus::Partial
        ));
        assert_eq!(value.computer_name.as_deref(), Some(expected_name.as_str()));
        assert!(!value.cpus.is_empty());
        assert!(value.memory.os_visible_bytes.is_some());
        assert!(!value.volumes.is_empty());
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(!serialized.contains("edgk_"));
        assert!(!serialized.contains("ANTHROPIC_API_KEY"));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires a Windows PowerShell process; run explicitly on the target host"]
    fn fixed_process_kills_and_reaps_on_timeout() {
        let path = powershell_path().expect("Windows PowerShell");
        let started = Instant::now();
        let result = run_fixed_process(
            &path,
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ],
            Duration::from_millis(100),
        );
        assert!(matches!(
            result,
            Ok(FixedProcessOutput {
                status: ProcessStatus::TimedOut,
                ..
            })
        ));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires a Windows PowerShell process; run explicitly on the target host"]
    fn timeout_keeps_first_complete_snapshot_before_reaping_child() {
        let path = powershell_path().expect("Windows PowerShell");
        let started = Instant::now();
        let result = run_fixed_process(
            &path,
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Write-Output '{\"computerName\":\"FIRST-SNAPSHOT\",\"os\":{\"caption\":\"Synthetic\"},\"cpus\":[],\"memory\":{},\"gpus\":[],\"volumes\":[]}'; Start-Sleep -Seconds 5",
            ],
            Duration::from_secs(1),
        )
        .expect("fixed helper should return bounded output");
        assert_eq!(result.status, ProcessStatus::TimedOut);
        let snapshot = parse_latest_probe_json(&result.stdout).expect("first JSON line");
        assert_eq!(snapshot.computer_name.as_deref(), Some("FIRST-SNAPSHOT"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
