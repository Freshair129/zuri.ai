// @spec FR-150 — actual portable Node/worker lifecycle against a synthetic loopback server.
use crate::supervisor::{ManagedProviderSettings, ManagedWorkerConfig, Supervisor};
use std::{path::PathBuf, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn wait_state(worker: &Supervisor, expected: &str) {
    tokio::time::timeout(Duration::from_secs(12), async {
        while worker.snapshot()["state"] != expected {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("packaged worker did not reach expected state");
}

#[tokio::test]
#[ignore = "Requires freshly assembled portable package in ZURI_DESKTOP_TEST_PACKAGE; run explicitly after packaging"]
async fn actual_portable_worker_starts_stops_and_recovers_from_owned_process_crash() {
    let root = PathBuf::from(std::env::var("ZURI_DESKTOP_TEST_PACKAGE").expect("set package path"));
    assert!(root.is_absolute());
    let data = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut bytes = vec![0; 8192];
                let mut length = 0;
                while length < bytes.len() {
                    let n = socket.read(&mut bytes[length..]).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    length += n;
                    if bytes[..length].windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&bytes[..length]);
                let claim = request.lines().next().unwrap_or("").contains("/claim ");
                let body = if claim {
                    ""
                } else {
                    "{\"acknowledged\":true,\"ok\":true,\"models\":[]}"
                };
                let status = if claim { "204 No Content" } else { "200 OK" };
                let reply = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = socket.write_all(reply.as_bytes()).await;
            });
        }
    });
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
    let config = ManagedWorkerConfig::from_package(
        root,
        data.path().to_path_buf(),
        "DEV-PACKAGE-FIXTURE".into(),
        origin.clone(),
        "edgk_synthetic_package_fixture".into(),
        None,
        Some(origin),
        provider,
    )
    .unwrap();
    let worker = Supervisor::default();
    let proof_worker = worker.clone();
    let proof = tokio::spawn(async move {
        let worker = proof_worker;
        worker
            .start(config.clone())
            .await
            .expect("packaged startup");
        wait_state(&worker, "RUNNING").await;
        let first_pid = worker.snapshot()["pid"].as_u64().unwrap();
        worker.start(config.clone()).await.unwrap();
        assert_eq!(worker.snapshot()["pid"], first_pid);
        worker.heartbeat().await.unwrap();
        tokio::time::timeout(Duration::from_secs(8), async {
            while worker.snapshot()["lastHeartbeatAt"].is_null() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("accepted packaged heartbeat");
        worker.stop().await.unwrap();
        assert_eq!(worker.snapshot()["state"], "STOPPED");
        assert!(!worker.is_active());
        worker.start(config.clone()).await.unwrap();
        wait_state(&worker, "RUNNING").await;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let pid = worker.snapshot()["pid"].as_u64().unwrap().to_string();
            let output = std::process::Command::new("taskkill.exe")
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(0x08000000)
                .output()
                .expect("terminate only this fixture's owned process");
            assert!(output.status.success());
            wait_state(&worker, "FAILED").await;
            worker
                .start(config)
                .await
                .expect("restart after forced process exit");
            wait_state(&worker, "RUNNING").await;
        }
    });
    // Teardown still runs when a proof assertion panics in its task.
    let result = proof.await;
    worker.stop().await.unwrap();
    server.abort();
    result.expect("portable lifecycle proof");
    assert!(!worker.snapshot().to_string().contains("edgk_"));
}
