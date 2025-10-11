use crate::storage;
use reqwest::Client;
use serde::Deserialize;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

#[derive(Default)]
pub struct PythonEngineState {
    child: Mutex<Option<Child>>,
    pub port: u16,
}

#[derive(Deserialize)]
struct ChatReply {
    reply: String,
}

impl PythonEngineState {
    pub fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port,
        }
    }
}

fn python_binary(override_path: Option<&str>) -> String {
    if let Some(path) = override_path {
        if !path.is_empty() {
            return path.to_string();
        }
    }

    if let Ok(python_path) = std::env::var("PRIVATE_AI_PYTHON") {
        if !python_path.is_empty() {
            return python_path;
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let venv_python = format!("{home}/.privateai-venv/bin/python");
        if std::path::Path::new(&venv_python).exists() {
            return venv_python;
        }
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

fn fallback_sidecar_path() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        let mut direct = cwd.clone();
        direct.push("python");
        direct.push("sidecar.py");
        candidates.push(direct);

        let mut parent = cwd.clone();
        parent.pop();
        parent.push("python");
        parent.push("sidecar.py");
        candidates.push(parent);
    }

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Unable to locate python/sidecar.py relative to current directory.".into())
}

fn resolve_sidecar_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let resolver = app_handle.path_resolver();
    let resource_candidates = ["python/sidecar.py", "../python/sidecar.py"];

    for candidate in resource_candidates.iter() {
        if let Some(resolved) = resolver.resolve_resource(candidate) {
            if resolved.exists() {
                return Ok(resolved);
            }
        }
    }

    let fallback = fallback_sidecar_path()?;
    if fallback.exists() {
        return Ok(fallback);
    }

    Err("Unable to locate python sidecar script. Ensure python/sidecar.py is packaged.".into())
}

async fn default_model_path() -> Result<PathBuf, String> {
    let base = storage::get_base_dir().await?;
    Ok(base.join("Models").join("gemma-1b-it-q4_0.gguf"))
}

fn first_available_model(models_dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("gguf"))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

async fn locate_model_path(requested: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = requested {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Ok(env_path) = std::env::var("PRIVATE_AI_MODEL_PATH") {
        let candidate = PathBuf::from(env_path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let default_path = default_model_path().await?;
    if default_path.exists() {
        return Ok(default_path);
    }

    let base = storage::get_base_dir().await?;
    let models_dir = base.join("Models");
    if let Some(found) = first_available_model(&models_dir) {
        return Ok(found);
    }

    Err(format!(
        "Model file not found. Place a GGUF under {} or set PRIVATE_AI_MODEL_PATH.",
        models_dir.display()
    ))
}

async fn python_engine_health_internal(port: u16) -> Result<bool, String> {
    let client = Client::new();
    match client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(err) => Err(format!("Python health check failed: {err}")),
    }
}

fn cleanup_child(guard: &mut Option<Child>) {
    if let Some(child) = guard {
        if let Ok(Some(_)) = child.try_wait() {
            *guard = None;
        }
    }
}

pub async fn start_python_engine(
    state: State<'_, PythonEngineState>,
    app_handle: AppHandle,
    model_path: Option<String>,
    python_binary_override: Option<String>,
) -> Result<String, String> {
    {
        let mut guard = state.child.lock().await;
        cleanup_child(&mut guard);
        if let Some(child) = guard.as_ref() {
            if child.id().is_some() {
                app_handle
                    .emit_all("python-status", "Python sidecar already running.")
                    .ok();
                return Ok("already running".into());
            }
        }
    }

    let script_path = resolve_sidecar_path(&app_handle)?;
    let model_path = locate_model_path(model_path).await?;

    let base_dir = storage::get_base_dir().await?;
    let log_path = base_dir.join("Logs").join("python-sidecar.log");
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Unable to open sidecar log file {}: {e}", log_path.display()))?;
    let log_file_err = log_file
        .try_clone()
        .map_err(|e| format!("Unable to clone log file handle: {e}"))?;

    let python = python_binary(python_binary_override.as_deref());
    let mut command = Command::new(&python);
    command
        .arg(&script_path)
        .arg("--port")
        .arg(state.port.to_string())
        .arg("--model")
        .arg(&model_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err))
        .env("PYTHONUNBUFFERED", "1");

    let child = command
        .spawn()
        .map_err(|e| format!("Unable to launch python sidecar using {python}: {e}"))?;

    {
        let mut guard = state.child.lock().await;
        *guard = Some(child);
    }

    app_handle
        .emit_all("python-status", "Python sidecar starting…")
        .ok();

    for attempt in 0..10 {
        match python_engine_health_internal(state.port).await {
            Ok(true) => {
                app_handle
                    .emit_all("python-status", "Python sidecar ready.")
                    .ok();
                return Ok(model_path.to_string_lossy().to_string());
            }
            Ok(false) => {}
            Err(err) => {
                if attempt == 9 {
                    return Err(format!(
                        "{err} (see {} for details)",
                        log_path.display()
                    ));
                }
            }
        }
        sleep(Duration::from_millis(350 + attempt as u64 * 150)).await;
    }

    Err(format!(
        "Python sidecar failed to respond in time. Check {} for details.",
        log_path.display()
    ))
}

pub async fn stop_python_engine(state: State<'_, PythonEngineState>) -> Result<String, String> {
    let mut guard = state.child.lock().await;
    cleanup_child(&mut guard);
    if let Some(mut child) = guard.take() {
        if let Err(err) = child.kill().await {
            return Err(format!("Unable to stop python sidecar: {err}"));
        }
        let _ = child.wait().await;
        return Ok("Python sidecar stopped.".into());
    }
    Ok("Python sidecar not running.".into())
}

pub async fn python_engine_health(state: State<'_, PythonEngineState>) -> Result<bool, String> {
    {
        let mut guard = state.child.lock().await;
        cleanup_child(&mut guard);
        if guard.is_none() {
            return Ok(false);
        }
    }
    python_engine_health_internal(state.port).await
}

pub async fn python_chat(
    state: State<'_, PythonEngineState>,
    message: String,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Message is empty.".into());
    }

    {
        let mut guard = state.child.lock().await;
        cleanup_child(&mut guard);
        if guard.is_none() {
            return Err("Python sidecar is not running.".into());
        }
    }

    let client = Client::new();
    let response = client
        .post(format!("http://127.0.0.1:{}/chat", state.port))
        .json(&serde_json::json!({ "prompt": message }))
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to reach python sidecar: {e}"))?;

    if !response.status().is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(format!("Python sidecar error: {text}"));
    }

    let reply: ChatReply = response
        .json()
        .await
        .map_err(|e| format!("Invalid JSON from sidecar: {e}"))?;

    Ok(reply.reply)
}

pub fn resolve_python_binary() -> String {
    python_binary(None)
}

pub async fn python_chat_stream(
    state: State<'_, PythonEngineState>,
    app_handle: AppHandle,
    message: String,
) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("Message is empty.".into());
    }

    {
        let mut guard = state.child.lock().await;
        cleanup_child(&mut guard);
        if guard.is_none() {
            return Err("Python sidecar is not running.".into());
        }
    }

    let client = Client::new();
    let response = client
        .post(format!("http://127.0.0.1:{}/chat/stream", state.port))
        .json(&serde_json::json!({ "prompt": message }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach python sidecar: {e}"))?;

    if !response.status().is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(format!("Python sidecar error: {text}"));
    }

    // Stream the response
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    let mut buffer = String::new();
    while let Some(item) = stream.next().await {
        match item {
            Ok(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                // Process complete SSE events
                while let Some(pos) = buffer.find("\n\n") {
                    let event = buffer[..pos].to_string();
                    buffer = buffer[pos + 2..].to_string();

                    // Parse SSE event
                    if let Some(data_line) = event.strip_prefix("data: ") {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data_line) {
                            if let Some(token) = json.get("token").and_then(|t| t.as_str()) {
                                app_handle.emit_all("python-stream-token", token).ok();
                            } else if json.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                                app_handle.emit_all("python-stream-done", "").ok();
                                return Ok(());
                            } else if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
                                return Err(format!("Stream error: {error}"));
                            }
                        }
                    }
                }
            }
            Err(e) => return Err(format!("Stream read error: {e}")),
        }
    }

    Ok(())
}
