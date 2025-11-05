use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnboardingState {
    pub completed: bool,
    pub legal_acceptance: Option<LegalAcceptance>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LegalAcceptance {
    pub eula_version: String,
    pub privacy_version: String,
    pub terms_version: String,
    pub accepted_at: DateTime<Utc>,
    pub analytics_opt_in: bool,
    pub app_version: String,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            completed: false,
            legal_acceptance: None,
        }
    }
}

/// Get the path to the onboarding config file
fn get_onboarding_config_path() -> Result<PathBuf> {
    let mut path = dirs::config_dir().context("Could not find config directory")?;
    path.push("PrivateAI");
    path.push("onboarding.json");
    Ok(path)
}

/// Check if running in dev mode
pub fn is_dev_mode() -> bool {
    // Check if DEV_MODE env var is set
    std::env::var("DEV_MODE").is_ok() ||
    // Or check if running in debug mode
    cfg!(debug_assertions)
}

/// Load onboarding state from disk
async fn load_onboarding_state() -> Result<OnboardingState> {
    let path = get_onboarding_config_path()?;

    if !path.exists() {
        return Ok(OnboardingState::default());
    }

    let contents = tokio::fs::read_to_string(&path)
        .await
        .context("Failed to read onboarding state")?;

    let state: OnboardingState =
        serde_json::from_str(&contents).context("Failed to parse onboarding state")?;

    Ok(state)
}

/// Save onboarding state to disk
async fn save_onboarding_state(state: &OnboardingState) -> Result<()> {
    let path = get_onboarding_config_path()?;

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    // Serialize and write
    let json =
        serde_json::to_string_pretty(state).context("Failed to serialize onboarding state")?;

    tokio::fs::write(&path, json)
        .await
        .context("Failed to write onboarding state")?;

    Ok(())
}

/// Check onboarding status (Tauri command)
#[tauri::command]
pub async fn check_onboarding_status() -> Result<OnboardingState, String> {
    // In dev mode, always return completed
    if is_dev_mode() {
        println!("[DEV MODE] Skipping onboarding");
        return Ok(OnboardingState {
            completed: true,
            legal_acceptance: Some(LegalAcceptance {
                eula_version: "1.0".into(),
                privacy_version: "1.0".into(),
                terms_version: "1.0".into(),
                accepted_at: Utc::now(),
                analytics_opt_in: false,
                app_version: "dev".into(),
            }),
        });
    }

    load_onboarding_state().await.map_err(|e| e.to_string())
}

/// Accept legal terms (Tauri command)
#[tauri::command]
pub async fn accept_legal_terms(
    eula_accepted: bool,
    privacy_accepted: bool,
    terms_accepted: bool,
    analytics_opt_in: bool,
) -> Result<LegalAcceptance, String> {
    // Validate all required terms are accepted
    if !eula_accepted || !privacy_accepted || !terms_accepted {
        return Err("All legal terms must be accepted to use PrivateAI".into());
    }

    let acceptance = LegalAcceptance {
        eula_version: "1.0".into(),
        privacy_version: "1.0".into(),
        terms_version: "1.0".into(),
        accepted_at: Utc::now(),
        analytics_opt_in,
        app_version: env!("CARGO_PKG_VERSION").into(),
    };

    // Load current state
    let mut state = load_onboarding_state().await.map_err(|e| e.to_string())?;

    // Update with acceptance
    state.legal_acceptance = Some(acceptance.clone());

    // Save state
    save_onboarding_state(&state)
        .await
        .map_err(|e| e.to_string())?;

    // Log acceptance for audit trail
    log_legal_acceptance(&acceptance).await;

    Ok(acceptance)
}

/// Complete onboarding (Tauri command)
#[tauri::command]
pub async fn complete_onboarding() -> Result<(), String> {
    let mut state = load_onboarding_state().await.map_err(|e| e.to_string())?;

    // Verify legal acceptance exists
    if state.legal_acceptance.is_none() {
        return Err("Legal terms must be accepted before completing onboarding".into());
    }

    state.completed = true;

    save_onboarding_state(&state)
        .await
        .map_err(|e| e.to_string())?;

    println!("[ONBOARDING] Completed successfully");
    Ok(())
}

/// Reset onboarding (for testing only)
#[tauri::command]
pub async fn reset_onboarding() -> Result<(), String> {
    if !is_dev_mode() {
        return Err("Reset is only available in development mode".into());
    }

    let path = get_onboarding_config_path().map_err(|e| e.to_string())?;

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| e.to_string())?;
    }

    println!("[DEV MODE] Onboarding reset");
    Ok(())
}

/// Log legal acceptance to audit log
async fn log_legal_acceptance(acceptance: &LegalAcceptance) {
    // Create log entry
    let log_entry = format!(
        "[{}] LEGAL_ACCEPTANCE - EULA v{}, Privacy v{}, Terms v{}, Analytics: {}, App: {}",
        acceptance.accepted_at.format("%Y-%m-%d %H:%M:%S UTC"),
        acceptance.eula_version,
        acceptance.privacy_version,
        acceptance.terms_version,
        acceptance.analytics_opt_in,
        acceptance.app_version,
    );

    // Try to write to log file
    if let Some(mut log_path) = dirs::config_dir() {
        log_path.push("PrivateAI");
        log_path.push("logs");

        if tokio::fs::create_dir_all(&log_path).await.is_ok() {
            log_path.push("legal_acceptance.log");

            if let Ok(mut file) = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .await
            {
                use tokio::io::AsyncWriteExt;
                let _ = file.write_all(format!("{}\n", log_entry).as_bytes()).await;
            }
        }
    }

    // Also log to stdout
    println!("{}", log_entry);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_default_state() {
        let state = OnboardingState::default();
        assert!(!state.completed);
        assert!(state.legal_acceptance.is_none());
    }

    #[tokio::test]
    async fn test_dev_mode_detection() {
        // In debug builds, should return true
        let is_dev = is_dev_mode();
        println!("Dev mode: {}", is_dev);
    }
}
