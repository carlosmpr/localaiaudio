use crate::{AppConfig, StoragePaths};
use std::path::{Path, PathBuf};
use tokio::fs;

pub async fn get_base_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join("PrivateAI"))
}

pub fn get_base_dir_blocking() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join("PrivateAI"))
}

pub async fn create_storage_layout() -> Result<StoragePaths, String> {
    let base_dir = get_base_dir().await?;

    // Create base directory
    fs::create_dir_all(&base_dir)
        .await
        .map_err(|e| format!("Failed to create base directory: {}", e))?;

    // Create subdirectories
    let subdirs = vec!["Chats", "Config", "Models", "Logs", "Index"];

    let paths = StoragePaths {
        base_dir: base_dir.clone(),
        chats: base_dir.join("Chats"),
        config: base_dir.join("Config"),
        models: base_dir.join("Models"),
        logs: base_dir.join("Logs"),
        index: base_dir.join("Index"),
    };

    for subdir in subdirs {
        let path = base_dir.join(subdir);
        fs::create_dir_all(&path)
            .await
            .map_err(|e| format!("Failed to create {} directory: {}", subdir, e))?;
    }

    Ok(paths)
}

pub async fn save_config(config: AppConfig) -> Result<String, String> {
    let base_dir = get_base_dir().await?;
    let config_dir = base_dir.join("Config");
    let config_path = config_dir.join("app.json");

    // Ensure config directory exists
    fs::create_dir_all(&config_dir)
        .await
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    // Serialize config
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Write to file
    fs::write(&config_path, json)
        .await
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(config_path.to_string_lossy().to_string())
}

pub async fn load_config() -> Result<Option<AppConfig>, String> {
    let base_dir = get_base_dir().await?;
    let config_path = base_dir.join("Config").join("app.json");

    // Check if config exists
    if !config_path.exists() {
        return Ok(None);
    }

    // Read file
    let content = fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    // Parse JSON
    let config: AppConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(Some(config))
}

pub async fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .await
        .map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
}

pub async fn delete_config() -> Result<String, String> {
    let base_dir = get_base_dir().await?;
    let config_path = base_dir.join("Config").join("app.json");

    // Check if config exists
    if !config_path.exists() {
        return Ok("No configuration file found".to_string());
    }

    // Delete the config file
    fs::remove_file(&config_path)
        .await
        .map_err(|e| format!("Failed to delete config file: {}", e))?;

    Ok(format!("Configuration deleted: {}", config_path.display()))
}
