use reqwest::Client;
use std::fs::{create_dir_all, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub struct ModelInfo {
    pub name: String,
    pub url: String,
    pub filename: String,
    pub size_mb: u64,
}

impl ModelInfo {
    pub fn llama32_1b() -> Self {
        Self {
            name: "Llama 3.2 1B Instruct".to_string(),
            url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf".to_string(),
            filename: "llama3.2-1b.gguf".to_string(),
            size_mb: 800,
        }
    }

    pub fn gemma_1b() -> Self {
        Self {
            name: "Gemma 3 1B Instruct".to_string(),
            url: "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_0.gguf".to_string(),
            filename: "gemma-3-1b-it-Q4_0.gguf".to_string(),
            size_mb: 722,
        }
    }

    pub fn phi3_mini() -> Self {
        Self {
            name: "Phi-3 Mini".to_string(),
            url: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf".to_string(),
            filename: "phi-3-mini-4k-instruct-q4.gguf".to_string(),
            size_mb: 2300,
        }
    }
}

pub async fn download_model(
    model_info: ModelInfo,
    target_dir: &Path,
    app_handle: AppHandle,
) -> Result<PathBuf, String> {
    // Ensure target directory exists
    create_dir_all(target_dir).map_err(|e| format!("Failed to create directory: {e}"))?;

    let target_path = target_dir.join(&model_info.filename);

    // Check if model already exists
    if target_path.exists() {
        app_handle
            .emit_all(
                "model-download-status",
                format!("Model {} already exists", model_info.filename),
            )
            .ok();
        return Ok(target_path);
    }

    app_handle
        .emit_all(
            "model-download-status",
            format!(
                "Downloading {} ({} MB)...",
                model_info.name, model_info.size_mb
            ),
        )
        .ok();

    let client = Client::new();
    let response = client
        .get(&model_info.url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;

    let mut file =
        File::create(&target_path).map_err(|e| format!("Failed to create file: {e}"))?;

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Download error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write to file: {e}"))?;

        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let percent = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            if percent != last_percent && percent % 5 == 0 {
                app_handle
                    .emit_all(
                        "model-download-progress",
                        serde_json::json!({
                            "percent": percent,
                            "downloaded_mb": downloaded / 1_048_576,
                            "total_mb": total_size / 1_048_576,
                        }),
                    )
                    .ok();
                last_percent = percent;
            }
        }
    }

    app_handle
        .emit_all(
            "model-download-status",
            format!("Downloaded {} successfully", model_info.filename),
        )
        .ok();

    Ok(target_path)
}

pub async fn download_default_model(
    target_dir: &Path,
    app_handle: AppHandle,
) -> Result<PathBuf, String> {
    let model_info = ModelInfo::llama32_1b();
    let target_path = target_dir.join(&model_info.filename);

    // PRIORITY 1: Check if model is bundled with the app - try multiple paths
    // This ensures we ALWAYS use the bundled model
    let resource_paths = vec![
        format!("Models/{}", model_info.filename),
        format!("../Models/{}", model_info.filename),
        format!("_up_/Models/{}", model_info.filename),
    ];

    for resource_path in resource_paths {
        if let Some(bundled_path) = app_handle.path_resolver().resolve_resource(&resource_path) {
            if bundled_path.exists() {
                app_handle
                    .emit_all(
                        "model-download-status",
                        format!("Using bundled model {}...", model_info.filename),
                    )
                    .ok();

                // Use the bundled model directly without copying to save space
                // The bundled path is stable and always available
                return Ok(bundled_path);
            }
        }
    }

    // PRIORITY 2: If no bundled model found (shouldn't happen in production),
    // check if already copied to target directory
    if target_path.exists() {
        app_handle
            .emit_all(
                "model-download-status",
                format!("Model {} already installed", model_info.filename),
            )
            .ok();
        return Ok(target_path);
    }

    // PRIORITY 3: Model not bundled and not in target directory - this is an error condition
    // The app should always have the bundled model
    Err(format!(
        "Bundled model {} not found. Please reinstall the application.",
        model_info.filename
    ))
}
