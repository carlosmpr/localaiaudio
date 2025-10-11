use futures_util::StreamExt;
use reqwest;
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use tauri::Manager;

const OLLAMA_API_BASE: &str = "http://localhost:11434";

#[derive(Debug, Serialize, Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaListResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaChatMessage>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaStreamResponse {
    message: Option<OllamaChatMessage>,
    done: Option<bool>,
    #[serde(default)]
    done_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ChatStreamPayload {
    content: String,
}

pub async fn check_ollama_installed() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    let check_path = "/usr/local/bin/ollama";

    #[cfg(target_os = "linux")]
    let check_path = "/usr/local/bin/ollama";

    #[cfg(target_os = "windows")]
    let check_path = "C:\\Program Files\\Ollama\\ollama.exe";

    Ok(std::path::Path::new(check_path).exists())
}

pub async fn check_ollama_running() -> Result<bool, String> {
    let client = reqwest::Client::new();
    match client
        .get(format!("{}/api/tags", OLLAMA_API_BASE))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

pub async fn install_ollama(app_handle: tauri::AppHandle) -> Result<String, String> {
    let os = std::env::consts::OS;

    match os {
        "macos" => {
            // Emit status update
            app_handle
                .emit_all("install-status", "Downloading Ollama for macOS...")
                .ok();

            // Download Ollama installer
            let url = "https://ollama.com/download/Ollama-darwin.zip";
            let installer_path = "/tmp/Ollama-darwin.zip";

            // Download file
            let client = reqwest::Client::new();
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Failed to download Ollama: {}", e))?;

            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read download: {}", e))?;

            std::fs::write(installer_path, bytes)
                .map_err(|e| format!("Failed to save installer: {}", e))?;

            app_handle
                .emit_all("install-status", "Installing Ollama...")
                .ok();

            // Extract and install
            Command::new("unzip")
                .args(["-o", installer_path, "-d", "/Applications"])
                .output()
                .map_err(|e| format!("Failed to extract Ollama: {}", e))?;

            // Create symlink for CLI
            app_handle
                .emit_all("install-status", "Setting up Ollama CLI...")
                .ok();

            Command::new("ln")
                .args(["-sf", "/Applications/Ollama.app/Contents/Resources/ollama", "/usr/local/bin/ollama"])
                .output()
                .ok();

            Ok("Ollama installed and started successfully".to_string())
        }
        "linux" => {
            app_handle
                .emit_all("install-status", "Installing Ollama on Linux...")
                .ok();

            // Use the official install script
            let output = Command::new("sh")
                .args(["-c", "curl -fsSL https://ollama.com/install.sh | sh"])
                .output()
                .map_err(|e| format!("Failed to install Ollama: {}", e))?;

            if output.status.success() {
                Ok("Ollama installed successfully".to_string())
            } else {
                Err(format!(
                    "Failed to install Ollama: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }
        "windows" => {
            app_handle
                .emit_all(
                    "install-status",
                    "Please download Ollama from https://ollama.com/download/windows",
                )
                .ok();

            // Open the download page
            tauri::api::shell::open(
                &app_handle.shell_scope(),
                "https://ollama.com/download/windows",
                None,
            )
            .ok();

            Err("Please install Ollama manually from the opened webpage and restart the app".to_string())
        }
        _ => Err(format!("Unsupported operating system: {}", os)),
    }
}

pub async fn start_ollama_service() -> Result<bool, String> {
    let os = std::env::consts::OS;

    if check_ollama_running().await? {
        return Ok(true);
    }

    match os {
        "macos" | "linux" => {
            // Try to start Ollama service
            let output = Command::new("ollama")
                .arg("serve")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();

            match output {
                Ok(_) => {
                    // Wait a bit for service to start
                    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                    Ok(true)
                }
                Err(e) => Err(format!("Failed to start Ollama service: {}", e)),
            }
        }
        "windows" => {
            // On Windows, Ollama should be running as a service
            // Just check if it's running
            check_ollama_running().await
        }
        _ => Err("Unsupported OS".to_string()),
    }
}

pub async fn list_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/tags", OLLAMA_API_BASE))
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))?;

    let models: OllamaListResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models: {}", e))?;

    Ok(models.models.iter().map(|m| m.name.clone()).collect())
}

pub async fn pull_model(model: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .emit_all("model-pull-status", format!("Pulling model: {}", model))
        .ok();

    let client = reqwest::Client::new();

    #[derive(Serialize)]
    struct PullRequest {
        name: String,
    }

    let response = client
        .post(format!("{}/api/pull", OLLAMA_API_BASE))
        .json(&PullRequest { name: model.clone() })
        .send()
        .await
        .map_err(|e| format!("Failed to pull model: {}", e))?;

    if response.status().is_success() {
        app_handle
            .emit_all("model-pull-status", format!("Model {} pulled successfully", model))
            .ok();
        Ok(format!("Model {} is ready", model))
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!("Failed to pull model: {}", error_text))
    }
}

pub async fn send_chat_message(
    message: String,
    model: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    app_handle
        .emit_all("chat-status", "Sending message to AI...")
        .ok();

    let client = reqwest::Client::new();

    let request = OllamaChatRequest {
        model: model.clone(),
        messages: vec![OllamaChatMessage {
            role: "user".to_string(),
            content: message,
        }],
        stream: true,
    };

    let response = client
        .post(format!("{}/api/chat", OLLAMA_API_BASE))
        .json(&request)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to send chat message: {}", e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Chat request failed: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer.drain(..=pos);

            if line.is_empty() {
                continue;
            }

            let event: OllamaStreamResponse =
                serde_json::from_str(&line).map_err(|e| format!("Invalid stream JSON: {}", e))?;

            if let Some(msg) = event.message {
                if msg.role == "assistant" {
                    accumulated.push_str(&msg.content);
                    app_handle
                        .emit_all(
                            "chat-stream",
                            ChatStreamPayload {
                                content: accumulated.clone(),
                            },
                        )
                        .ok();
                }
            }

            if event.done.unwrap_or(false) {
                if let Some(reason) = event.done_reason {
                    app_handle
                        .emit_all("chat-status", format!("Stream finished: {}", reason))
                        .ok();
                }
            }
        }
    }

    app_handle.emit_all("chat-status", "Response received").ok();

    Ok(accumulated)
}
