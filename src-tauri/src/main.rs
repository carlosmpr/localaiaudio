// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod model_catalog;
#[cfg(feature = "runtime-ollama")]
mod ollama;
#[cfg(feature = "runtime-python")]
mod python_engine;
mod storage;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
#[cfg(feature = "runtime-python")]
use tauri::State;
#[cfg(feature = "runtime-python")]
use python_engine::PythonEngineState;
use model_catalog::ModelCatalogEntry;

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
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    ollama::send_chat_message(message, model, app_handle).await
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
) -> Result<String, String> {
    python_engine::python_chat(state, message).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
async fn python_chat_stream(
    state: State<'_, PythonEngineState>,
    app_handle: tauri::AppHandle,
    message: String,
) -> Result<(), String> {
    python_engine::python_chat_stream(state, app_handle, message).await
}

#[cfg(feature = "runtime-python")]
#[tauri::command]
fn resolve_python_binary() -> String {
    python_engine::resolve_python_binary()
}

fn main() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "runtime-python")]
    let builder = builder.manage(PythonEngineState::new(32121));

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
    ]);

    #[cfg(all(not(feature = "runtime-ollama"), feature = "runtime-python"))]
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
    ]);

    #[cfg(all(not(feature = "runtime-ollama"), not(feature = "runtime-python")))]
    compile_error!("At least one runtime feature (runtime-ollama or runtime-python) must be enabled.");

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
