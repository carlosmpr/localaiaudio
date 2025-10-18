// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod conversation;
mod hardware;
mod model_catalog;
mod model_downloader;
#[cfg(feature = "runtime-ollama")]
mod ollama;
#[cfg(feature = "runtime-python")]
mod python_engine;
#[cfg(feature = "runtime-embedded")]
mod embedded_runtime;
mod storage;
mod document_parser;

use conversation::{ChatRecord, ConversationMessage, ConversationSummary};
use model_catalog::ModelCatalogEntry;
#[cfg(feature = "runtime-python")]
use python_engine::PythonEngineState;
#[cfg(feature = "runtime-embedded")]
use embedded_runtime::EmbeddedRuntimeState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;
#[cfg(any(feature = "runtime-python", feature = "runtime-embedded"))]
use tauri::State;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

fn history_inputs_to_messages(history: Vec<ConversationHistoryInput>) -> Vec<ConversationMessage> {
    history
        .into_iter()
        .map(|m| ConversationMessage {
            role: m.role,
            content: m.content,
        })
        .collect::<Vec<_>>()
}

fn ensure_trailing_user(messages: &mut Vec<ConversationMessage>, latest_user: &str) {
    if messages
        .last()
        .map(|entry| entry.role != "user")
        .unwrap_or(true)
    {
        messages.push(ConversationMessage {
            role: "user".into(),
            content: latest_user.to_string(),
        });
    } else if let Some(last) = messages.last_mut() {
        last.content = latest_user.to_string();
    }
}

async fn resolve_history_messages(
    history: Vec<ConversationHistoryInput>,
    session_id: Option<String>,
    chats_dir: Option<String>,
    latest_user: &str,
) -> Result<(Vec<ConversationMessage>, &'static str), String> {
    let mut in_memory = history_inputs_to_messages(history);
    ensure_trailing_user(&mut in_memory, latest_user);

    if let Some(session_id) = session_id {
        let dir = conversation::resolve_chats_dir(chats_dir.as_deref())?;
        let records = conversation::load_records(&dir, &session_id, None).await?;

        if records.is_empty() {
            return Ok((in_memory, "in-memory"));
        }

        let mut persisted = records
            .into_iter()
            .map(|record| ConversationMessage {
                role: record.role,
                content: record.content,
            })
            .collect::<Vec<_>>();

        ensure_trailing_user(&mut persisted, latest_user);

        if persisted.len() < in_memory.len() {
            persisted.extend(in_memory.into_iter().skip(persisted.len()));
        }

        Ok((persisted, "persisted"))
    } else {
        Ok((in_memory, "in-memory"))
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct HardwareInfo {
    os: String,
    cpu: CpuInfo,
    ram_gb: f64,
    gpu: Option<GpuInfo>,
    disk: DiskInfo,
    network: NetworkInfo,
}

#[derive(Debug, Serialize, Deserialize)]
struct CpuInfo {
    vendor: String,
    model: String,
    physical_cores: usize,
    logical_cores: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct GpuInfo {
    vendor: String,
    model: String,
    vram_gb: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DiskInfo {
    free_gb: f64,
    total_gb: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct NetworkInfo {
    connected: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppConfig {
    version: String,
    created_at: String,
    hardware: HardwareInfo,
    model: ModelConfig,
    paths: StoragePaths,
    #[serde(default)]
    runtime: RuntimeConfig,
    #[serde(default)]
    backend: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelConfig {
    selected: String,
    status: String,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoragePaths {
    base_dir: PathBuf,
    chats: PathBuf,
    config: PathBuf,
    models: PathBuf,
    logs: PathBuf,
    index: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct RuntimeConfig {
    #[serde(default)]
    ollama: Option<Value>,
    #[serde(default)]
    python: Option<PythonRuntimeConfig>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct PythonRuntimeConfig {
    #[serde(default)]
    binary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatRecordInput {
    role: String,
    content: String,
    #[serde(default)]
    timestamp: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConversationHistoryInput {
    role: String,
    content: String,
}

#[tauri::command]
async fn scan_hardware() -> Result<HardwareInfo, String> {
    hardware::scan_hardware().await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn check_ollama_installed() -> Result<bool, String> {
    ollama::check_ollama_installed().await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn install_ollama(app_handle: tauri::AppHandle) -> Result<String, String> {
    ollama::install_ollama(app_handle).await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn start_ollama_service() -> Result<bool, String> {
    ollama::start_ollama_service().await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn check_ollama_running() -> Result<bool, String> {
    ollama::check_ollama_running().await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn list_ollama_models() -> Result<Vec<String>, String> {
    ollama::list_models().await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn pull_ollama_model(model: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    ollama::pull_model(model, app_handle).await
}

#[cfg(feature = "runtime-ollama")]
#[tauri::command]
async fn send_chat_message(
    message: String,
    model: String,
    history: Vec<ConversationHistoryInput>,
    session_id: Option<String>,
    chats_dir: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (history_messages, source) =
        resolve_history_messages(history, session_id, chats_dir, &message).await?;
    app_handle
        .emit_all(
            "chat-status",
            format!(
                "Using {} prior message(s) for context ({})",
                history_messages.len(),
                source
            ),
        )
        .ok();
    ollama::send_chat_message(message, model, history_messages, app_handle).await
}

#[tauri::command]
async fn setup_storage() -> Result<StoragePaths, String> {
    storage::create_storage_layout().await
}

#[tauri::command]
async fn save_config(config: AppConfig) -> Result<String, String> {
    storage::save_config(config).await
}

#[tauri::command]
async fn load_config() -> Result<Option<AppConfig>, String> {
    storage::load_config().await
}

#[tauri::command]
async fn delete_config() -> Result<String, String> {
    storage::delete_config().await
}

#[tauri::command]
async fn get_model_catalog() -> Result<Vec<ModelCatalogEntry>, String> {
    model_catalog::load_catalog()
}

#[tauri::command]
fn get_available_runtimes() -> Vec<String> {
    let mut runtimes = Vec::new();
    #[cfg(feature = "runtime-ollama")]
    {
        runtimes.push("ollama".to_string());
    }
    #[cfg(feature = "runtime-python")]
    {
        runtimes.push("python".to_string());
    }
    #[cfg(feature = "runtime-embedded")]
    {
        runtimes.push("embedded".to_string());
    }
    runtimes
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn start_python_engine(
    state: State<'_, PythonEngineState>,
    app_handle: tauri::AppHandle,
    model_path: Option<String>,
    python_binary: Option<String>,
) -> Result<String, String> {
    python_engine::start_python_engine(state, app_handle, model_path, python_binary).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn stop_python_engine(state: State<'_, PythonEngineState>) -> Result<String, String> {
    python_engine::stop_python_engine(state).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn python_engine_health(state: State<'_, PythonEngineState>) -> Result<bool, String> {
    python_engine::python_engine_health(state).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn python_chat(
    state: State<'_, PythonEngineState>,
    message: String,
    history: Vec<ConversationHistoryInput>,
    session_id: Option<String>,
    chats_dir: Option<String>,
) -> Result<String, String> {
    let (history_messages, _) =
        resolve_history_messages(history, session_id, chats_dir, &message).await?;
    python_engine::python_chat(state, message, history_messages).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn python_chat_stream(
    state: State<'_, PythonEngineState>,
    app_handle: tauri::AppHandle,
    message: String,
    history: Vec<ConversationHistoryInput>,
    session_id: Option<String>,
    chats_dir: Option<String>,
) -> Result<(), String> {
    let (history_messages, source) =
        resolve_history_messages(history, session_id, chats_dir, &message).await?;
    app_handle
        .emit_all(
            "chat-status",
            format!(
                "Using {} prior message(s) for context ({})",
                history_messages.len(),
                source
            ),
        )
        .ok();
    python_engine::python_chat_stream(state, app_handle, message, history_messages).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
fn resolve_python_binary() -> String {
    python_engine::resolve_python_binary()
}

// Embedded runtime commands
#[cfg(feature = "runtime-embedded")]
#[tauri::command]
async fn load_embedded_model(
    model_path: String,
    state: State<'_, EmbeddedRuntimeState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    embedded_runtime::load_model(model_path, state, app_handle).await
}

#[cfg(feature = "runtime-embedded")]
#[tauri::command]
async fn unload_embedded_model(
    state: State<'_, EmbeddedRuntimeState>,
) -> Result<String, String> {
    embedded_runtime::unload_model(state).await
}

#[cfg(feature = "runtime-embedded")]
#[tauri::command]
async fn embedded_chat_stream(
    message: String,
    history: Vec<ConversationHistoryInput>,
    session_id: Option<String>,
    chats_dir: Option<String>,
    state: State<'_, EmbeddedRuntimeState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let (history_messages, source) =
        resolve_history_messages(history, session_id, chats_dir, &message).await?;
    app_handle
        .emit_all(
            "chat-status",
            format!(
                "Using {} prior message(s) for context ({})",
                history_messages.len(),
                source
            ),
        )
        .ok();
    embedded_runtime::chat_with_model(message, history_messages, state, app_handle).await
}

#[cfg(feature = "runtime-embedded")]
#[tauri::command]
async fn cancel_embedded_generation(
    state: State<'_, EmbeddedRuntimeState>,
) -> Result<(), String> {
    let mut cancel_flag = state.cancel_generation.lock().await;
    *cancel_flag = true;
    Ok(())
}

#[tauri::command]
async fn ensure_directory(path: String) -> Result<(), String> {
    let dir = PathBuf::from(path);
    storage::ensure_directory(dir.as_path()).await
}

#[tauri::command]
async fn append_chat_records(
    session_id: String,
    records: Vec<ChatRecordInput>,
    chats_dir: Option<String>,
) -> Result<(), String> {
    let dir = conversation::resolve_chats_dir(chats_dir.as_deref())?;
    conversation::append_records(
        &dir,
        &session_id,
        &records
            .into_iter()
            .map(|r| ChatRecord {
                role: r.role,
                content: r.content,
                timestamp: r.timestamp,
            })
            .collect::<Vec<_>>(),
    )
    .await
}

#[tauri::command]
async fn load_chat_history(
    session_id: String,
    chats_dir: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ChatRecord>, String> {
    let dir = conversation::resolve_chats_dir(chats_dir.as_deref())?;
    conversation::load_records(&dir, &session_id, limit).await
}

#[tauri::command]
async fn list_chat_sessions(chats_dir: Option<String>) -> Result<Vec<ConversationSummary>, String> {
    let dir = conversation::resolve_chats_dir(chats_dir.as_deref())?;
    conversation::list_conversations(&dir).await
}

#[tauri::command]
async fn delete_chat_session(
    session_id: String,
    chats_dir: Option<String>,
) -> Result<(), String> {
    let dir = conversation::resolve_chats_dir(chats_dir.as_deref())?;
    conversation::delete_conversation(&dir, &session_id).await
}

#[tauri::command]
async fn download_model(
    target_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let target_path = PathBuf::from(target_dir);
    let downloaded_path = model_downloader::download_default_model(&target_path, app_handle).await?;
    Ok(downloaded_path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
struct DocumentInfo {
    path: String,
    name: String,
    text: String,
    summary: String,
}

#[tauri::command]
async fn parse_document(file_path: String) -> Result<DocumentInfo, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let text = document_parser::extract_document_text(&path)
        .map_err(|e| format!("Failed to extract text: {}", e))?;

    let summary = document_parser::get_document_summary(&path, &text)
        .map_err(|e| format!("Failed to generate summary: {}", e))?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(DocumentInfo {
        path: file_path,
        name,
        text,
        summary,
    })
}

fn init_logging() -> Option<PathBuf> {
    use std::fs;

    let base_dir = storage::get_base_dir_blocking().ok()?;
    let logs_dir = base_dir.join("Logs");
    if let Err(err) = fs::create_dir_all(&logs_dir) {
        eprintln!(
            "Failed to create log directory {}: {}",
            logs_dir.display(),
            err
        );
        return None;
    }

    let log_file_name = "privateai.log";
    let appender = tracing_appender::rolling::never(&logs_dir, log_file_name);
    let (non_blocking, guard) = tracing_appender::non_blocking(appender);
    let _ = LOG_GUARD.set(guard);

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_ansi(false)
        .with_writer(non_blocking)
        .try_init()
        .is_err()
    {
        eprintln!(
            "Failed to initialize file logger at {}",
            logs_dir.join(log_file_name).display()
        );
        return None;
    }

    Some(logs_dir.join(log_file_name))
}

fn main() {
    let log_path = init_logging();
    if let Some(path) = &log_path {
        println!("File logging initialized at {}", path.display());
    }

    let builder = tauri::Builder::default();

    #[cfg(feature = "runtime-python")]
    let builder = builder.manage(PythonEngineState::new(32121));

    #[cfg(feature = "runtime-embedded")]
    let builder = builder.manage(EmbeddedRuntimeState::new());

    #[cfg(all(feature = "runtime-ollama", feature = "runtime-python"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        scan_hardware,
        setup_storage,
        save_config,
        load_config,
        get_model_catalog,
        get_available_runtimes,
        check_ollama_installed,
        install_ollama,
        start_ollama_service,
        check_ollama_running,
        list_ollama_models,
        pull_ollama_model,
        send_chat_message,
        start_python_engine,
        stop_python_engine,
        python_engine_health,
        python_chat,
        python_chat_stream,
        resolve_python_binary,
        ensure_directory,
        append_chat_records,
        load_chat_history,
        list_chat_sessions,
        delete_chat_session,
        download_model,
    ]);

    #[cfg(all(feature = "runtime-ollama", not(feature = "runtime-python")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        scan_hardware,
        setup_storage,
        save_config,
        load_config,
        get_model_catalog,
        get_available_runtimes,
        check_ollama_installed,
        install_ollama,
        start_ollama_service,
        check_ollama_running,
        list_ollama_models,
        pull_ollama_model,
        send_chat_message,
        ensure_directory,
        append_chat_records,
        load_chat_history,
        list_chat_sessions,
        delete_chat_session,
    ]);

    #[cfg(all(not(feature = "runtime-ollama"), feature = "runtime-python", not(feature = "runtime-embedded")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        scan_hardware,
        setup_storage,
        save_config,
        load_config,
        get_model_catalog,
        get_available_runtimes,
        start_python_engine,
        stop_python_engine,
        python_engine_health,
        python_chat,
        python_chat_stream,
        resolve_python_binary,
        ensure_directory,
        append_chat_records,
        load_chat_history,
        list_chat_sessions,
        delete_chat_session,
        download_model,
    ]);

    #[cfg(all(not(feature = "runtime-ollama"), not(feature = "runtime-python"), feature = "runtime-embedded"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        scan_hardware,
        setup_storage,
        save_config,
        load_config,
        delete_config,
        get_model_catalog,
        get_available_runtimes,
        load_embedded_model,
        unload_embedded_model,
        embedded_chat_stream,
        cancel_embedded_generation,
        ensure_directory,
        append_chat_records,
        load_chat_history,
        list_chat_sessions,
        delete_chat_session,
        download_model,
        parse_document,
    ]);

    #[cfg(all(not(feature = "runtime-ollama"), not(feature = "runtime-python"), not(feature = "runtime-embedded")))]
    compile_error!(
        "At least one runtime feature (runtime-ollama, runtime-python, or runtime-embedded) must be enabled."
    );

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
