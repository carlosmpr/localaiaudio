use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

// Public key will be embedded at compile time (after you generate it)
// For now, we'll use a placeholder that you'll replace
const PUBLIC_KEY_PEM: &str = include_str!("license_public_key.pem");

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseData {
    pub email: String,
    pub tier: String,            // "personal" | "pro" | "enterprise"
    pub max_devices: u32,        // 1, 3, or 999
    pub issued_at: i64,          // Unix timestamp
    pub expires_at: Option<i64>, // None = lifetime, Some = expiry
    pub version: String,         // "1.0"
    pub id: String,              // Unique license ID
}

#[derive(Debug, Serialize, Deserialize)]
struct License {
    data: LicenseData,
    signature: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivatedLicense {
    pub license_data: LicenseData,
    pub hardware_id: String,
    pub activated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrialInfo {
    pub started_at: i64,
    pub expires_at: i64,
    pub hardware_id: String,
    pub status: String, // "active" | "expired" | "converted"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrity_hash: Option<String>, // Hash to prevent tampering
}

impl TrialInfo {
    /// Calculate integrity hash to prevent tampering
    fn calculate_hash(&self) -> String {
        let data = format!(
            "{}:{}:{}:{}",
            self.started_at, self.expires_at, self.hardware_id, self.status
        );
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        hasher.update(b"PRIVATEAI_TRIAL_SALT_V1"); // Salt to make tampering harder
        format!("{:x}", hasher.finalize())
    }

    /// Verify integrity hash
    fn verify_integrity(&self) -> bool {
        match &self.integrity_hash {
            Some(hash) => hash == &self.calculate_hash(),
            None => false, // Old trials without hash are invalid
        }
    }
}

/// Generate hardware fingerprint
pub fn get_hardware_fingerprint() -> Result<String> {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_all();

    // Get CPU brand
    let cpu_brand = sys.global_cpu_info().brand().to_string();

    // Get OS version using static method
    let os_version = System::os_version().unwrap_or_else(|| "unknown".to_string());

    // Get hostname using static method
    let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());

    // Combine and hash
    let combined = format!("{}:{}:{}", cpu_brand, hostname, os_version);
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    let result = hasher.finalize();

    Ok(format!("{:x}", result))
}

/// Validate license signature using embedded public key
fn validate_signature(data: &LicenseData, signature_b64: &str) -> Result<()> {
    use pkcs8::DecodePublicKey;
    use rsa::{pkcs1v15::VerifyingKey, signature::Verifier, RsaPublicKey};

    // Ensure build-time embedding is wired correctly
    if PUBLIC_KEY_PEM.trim().is_empty() || PUBLIC_KEY_PEM.contains("PLACEHOLDER") {
        bail!("Public key not properly embedded. App needs to be rebuilt with real keys.");
    }

    // Parse the embedded public key
    let public_key = RsaPublicKey::from_public_key_pem(PUBLIC_KEY_PEM)
        .context("Failed to parse embedded public key")?;

    // Decode signature from base64
    let signature = general_purpose::STANDARD
        .decode(signature_b64)
        .context("Invalid signature encoding")?;

    // Serialize license data to JSON (must match server's serialization)
    let data_json = serde_json::to_string(data).context("Failed to serialize license data")?;

    // Create verifier using SHA256
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);

    // Convert signature bytes to Signature type
    let sig = rsa::pkcs1v15::Signature::try_from(signature.as_slice())
        .map_err(|_| anyhow::anyhow!("Invalid signature format"))?;

    // Verify signature
    verifying_key
        .verify(data_json.as_bytes(), &sig)
        .map_err(|_| {
            anyhow::anyhow!("Invalid license signature - this license was not issued by PrivateAI")
        })?;

    println!("[LICENSE] Signature verification passed ✓");
    Ok(())
}

/// Get path to stored license
fn get_license_path() -> Result<PathBuf> {
    let mut path = dirs::config_dir().context("Could not find config directory")?;
    path.push("PrivateAI");
    path.push("license.json");
    Ok(path)
}

/// Get path to trial info
fn get_trial_path() -> Result<PathBuf> {
    let mut path = dirs::config_dir().context("Could not find config directory")?;
    path.push("PrivateAI");
    path.push("trial.json");
    Ok(path)
}

/// Get path to revoked licenses blacklist (hidden file)
fn get_revoked_licenses_path() -> Result<PathBuf> {
    let mut path = dirs::config_dir().context("Could not find config directory")?;
    path.push("PrivateAI");
    path.push(".revoked");
    Ok(path)
}

fn license_server_base_url() -> String {
    if let Ok(url) = std::env::var("PRIVATEAI_LICENSE_SERVER_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if cfg!(debug_assertions) {
        "https://localai-production-0df9.up.railway.app".to_string()
    } else {
        "https://localai-production-0df9.up.railway.app".to_string()
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct RevokedLicenses {
    licenses: Vec<String>, // List of revoked license IDs
    updated_at: i64,
}

/// Check if a license ID is in the revoked blacklist
async fn is_license_revoked(license_id: &str) -> Result<bool> {
    let path = get_revoked_licenses_path()?;

    if !path.exists() {
        return Ok(false);
    }

    let contents = tokio::fs::read_to_string(&path)
        .await
        .context("Failed to read revoked licenses")?;

    let revoked: RevokedLicenses =
        serde_json::from_str(&contents).context("Failed to parse revoked licenses")?;

    Ok(revoked.licenses.contains(&license_id.to_string()))
}

/// Add a license ID to the revoked blacklist
async fn add_to_revoked_blacklist(license_id: &str) -> Result<()> {
    let path = get_revoked_licenses_path()?;

    // Create parent directory if needed
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    // Load existing blacklist or create new one
    let mut revoked = if path.exists() {
        let contents = tokio::fs::read_to_string(&path).await?;
        serde_json::from_str::<RevokedLicenses>(&contents).unwrap_or_else(|_| RevokedLicenses {
            licenses: Vec::new(),
            updated_at: 0,
        })
    } else {
        RevokedLicenses {
            licenses: Vec::new(),
            updated_at: 0,
        }
    };

    // Add license ID if not already present
    let license_id_str = license_id.to_string();
    if !revoked.licenses.contains(&license_id_str) {
        revoked.licenses.push(license_id_str);
        revoked.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // Save to disk
        let json = serde_json::to_string_pretty(&revoked)?;
        tokio::fs::write(&path, json).await?;

        println!("[BLACKLIST] Added license {} to revoked list", license_id);
    }

    Ok(())
}

async fn register_activation_with_server(license_id: &str, hardware_id: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let base_url = license_server_base_url();
    let url = format!("{}/license/activate", base_url);

    let response = client
        .post(&url)
        .json(&json!({
            "licenseId": license_id,
            "hardwareId": hardware_id,
        }))
        .send()
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "Unable to reach the license server. Please ensure you are connected to the internet before activating. ({})",
                e
            )
        })?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to parse license server response: {}", e))?;

    if status.is_success() {
        return Ok(());
    }

    let _code = body
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let message = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("License activation failed");

    bail!("License activation failed: {}", message);
}

async fn deregister_activation_with_server(license_id: &str, hardware_id: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let base_url = license_server_base_url();
    let url = format!("{}/license/deactivate", base_url);

    let response = client
        .post(&url)
        .json(&json!({
            "licenseId": license_id,
            "hardwareId": hardware_id,
        }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to contact license server: {}", e))?;

    if response.status().is_success() {
        return Ok(());
    }

    println!(
        "[LICENSE] Warning: Failed to deregister license {} on server (status: {})",
        license_id,
        response.status()
    );
    Ok(())
}

/// Start trial
pub async fn start_trial() -> Result<TrialInfo> {
    let trial_path = get_trial_path()?;

    // Check if trial already started
    if trial_path.exists() {
        let contents = tokio::fs::read_to_string(&trial_path)
            .await
            .context("Failed to read trial info")?;

        let trial: TrialInfo =
            serde_json::from_str(&contents).context("Failed to parse trial info")?;

        // Verify hardware (prevents re-trialing by reinstalling)
        let current_hw = get_hardware_fingerprint()?;
        if trial.hardware_id != current_hw {
            bail!("Trial already used on a different device");
        }

        return Ok(trial);
    }

    // Start new trial
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut trial = TrialInfo {
        started_at: now,
        expires_at: now + (7 * 24 * 60 * 60), // 7 days
        hardware_id: get_hardware_fingerprint()?,
        status: "active".to_string(),
        integrity_hash: None, // Will be set below
    };

    // Generate integrity hash to prevent tampering
    trial.integrity_hash = Some(trial.calculate_hash());

    // Save trial
    if let Some(parent) = trial_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    let json = serde_json::to_string_pretty(&trial).context("Failed to serialize trial info")?;

    tokio::fs::write(&trial_path, json)
        .await
        .context("Failed to write trial info")?;

    println!("[TRIAL] Started 7-day trial");
    Ok(trial)
}

/// Activate license
pub async fn activate_license(license_code: &str) -> Result<ActivatedLicense> {
    // Decode base64
    let decoded = general_purpose::STANDARD
        .decode(license_code.trim())
        .context("Invalid license format - must be base64 encoded")?;

    // Parse JSON
    let license: License =
        serde_json::from_slice(&decoded).context("Invalid license structure - corrupted data")?;

    // CHECK BLACKLIST FIRST - works offline and prevents refunded license reactivation
    if is_license_revoked(&license.data.id).await.unwrap_or(false) {
        println!(
            "[LICENSE] License {} is in revoked blacklist",
            license.data.id
        );
        bail!("License not valid. This license has been refunded or revoked and cannot be used. Please purchase a new license to continue using PrivateAI.");
    }

    // Validate signature
    validate_signature(&license.data, &license.signature)?;

    // Try to validate with server if online (prevents refunded license reactivation)
    let validation_url = format!(
        "{}/validate-license/{}",
        license_server_base_url(),
        license.data.id
    );

    println!("[LICENSE] Validating with server: {}", validation_url);

    match reqwest::get(&validation_url).await {
        Ok(response) => {
            if let Ok(body) = response.json::<serde_json::Value>().await {
                let is_valid = body.get("valid").and_then(|v| v.as_bool()).unwrap_or(true);

                if !is_valid {
                    let reason = body
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let message = body
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("License validation failed");

                    match reason {
                        "refunded" => {
                            println!("[LICENSE] Server reports license was refunded");
                            // Add to local blacklist for offline protection
                            if let Err(e) = add_to_revoked_blacklist(&license.data.id).await {
                                println!("[LICENSE] Warning: Failed to add to blacklist: {}", e);
                            }
                            bail!("This license has been refunded and cannot be reactivated. Please purchase a new license.");
                        }
                        "expired" => {
                            println!("[LICENSE] Server reports license has expired");
                            bail!("This license has expired. Please renew your license.");
                        }
                        "not_found" => {
                            println!("[LICENSE] Server reports license ID not found");
                            bail!("License not recognized by server. Please contact support.");
                        }
                        _ => {
                            println!(
                                "[LICENSE] Server validation failed: {} - {}",
                                reason, message
                            );
                            bail!("License validation failed: {}", message);
                        }
                    }
                }

                println!("[LICENSE] Server validation passed ✓");
            }
        }
        Err(e) => {
            // Server unreachable - log warning but allow offline activation
            println!(
                "[LICENSE] Warning: Unable to verify license with server (offline mode): {}",
                e
            );
            println!("[LICENSE] Proceeding with offline activation - license will be verified when online");
        }
    }

    // Check expiry
    if let Some(expires_at) = license.data.expires_at {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        if now > expires_at {
            bail!("License has expired");
        }
    }

    // Get hardware fingerprint
    let hardware_id = get_hardware_fingerprint()?;

    // Check if different license already activated
    let existing = load_activated_license().await?;
    if let Some(existing_license) = existing {
        if existing_license.license_data.id != license.data.id {
            bail!(
                "A different license is already activated on this device. Please deactivate first."
            );
        }

        // Same license, refresh activation server-side but allow offline failures
        if let Err(err) = register_activation_with_server(&license.data.id, &hardware_id).await {
            println!(
                "[LICENSE] Warning: Unable to refresh activation with server: {}",
                err
            );
        }

        return Ok(existing_license);
    }

    // Register this hardware with the license server before saving locally
    register_activation_with_server(&license.data.id, &hardware_id).await?;

    // Create activated license
    let activated = ActivatedLicense {
        license_data: license.data.clone(),
        hardware_id: hardware_id.clone(),
        activated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    };

    // Save to disk
    if let Err(err) = save_activated_license(&activated).await {
        if let Err(cleanup_err) =
            deregister_activation_with_server(&activated.license_data.id, &activated.hardware_id)
                .await
        {
            println!(
                "[LICENSE] Warning: Failed to roll back server activation: {}",
                cleanup_err
            );
        }
        return Err(err);
    }

    // Mark trial as converted (if exists)
    let trial_path = get_trial_path()?;
    if trial_path.exists() {
        let contents = tokio::fs::read_to_string(&trial_path).await?;
        if let Ok(mut trial) = serde_json::from_str::<TrialInfo>(&contents) {
            trial.status = "converted".to_string();
            let json = serde_json::to_string_pretty(&trial)?;
            tokio::fs::write(&trial_path, json).await?;
        }
    }

    println!(
        "[LICENSE] Activated: {} ({})",
        activated.license_data.email, activated.license_data.tier
    );
    Ok(activated)
}

/// Save activated license
async fn save_activated_license(license: &ActivatedLicense) -> Result<()> {
    let path = get_license_path()?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    let json = serde_json::to_string_pretty(license).context("Failed to serialize license")?;

    tokio::fs::write(&path, json)
        .await
        .context("Failed to write license")?;

    Ok(())
}

/// Load activated license
async fn load_activated_license() -> Result<Option<ActivatedLicense>> {
    let path = get_license_path()?;

    if !path.exists() {
        return Ok(None);
    }

    let contents = tokio::fs::read_to_string(&path)
        .await
        .context("Failed to read license")?;

    let license: ActivatedLicense =
        serde_json::from_str(&contents).context("Failed to parse license")?;

    Ok(Some(license))
}

/// Validate activated license
pub async fn validate_activated_license() -> Result<Option<ActivatedLicense>> {
    let license = match load_activated_license().await? {
        Some(l) => l,
        None => return Ok(None),
    };

    // Verify hardware hasn't changed
    let current_hardware = get_hardware_fingerprint()?;
    if license.hardware_id != current_hardware {
        bail!("License hardware mismatch - this license is activated on a different device");
    }

    // Check expiry
    if let Some(expires_at) = license.license_data.expires_at {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        if now > expires_at {
            bail!("License has expired");
        }
    }

    Ok(Some(license))
}

// ============================================
// Tauri Commands
// ============================================

#[tauri::command]
pub async fn start_trial_command() -> Result<TrialInfo, String> {
    start_trial().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_trial_status() -> Result<Option<TrialInfo>, String> {
    let trial_path = get_trial_path().map_err(|e| e.to_string())?;

    if !trial_path.exists() {
        return Ok(None);
    }

    let contents = tokio::fs::read_to_string(&trial_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut trial: TrialInfo = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    // Verify integrity hash to prevent tampering
    if !trial.verify_integrity() {
        return Err(
            "Trial data has been tampered with. Please reinstall the application.".to_string(),
        );
    }

    // Verify hardware hasn't changed (prevents copying trial to another machine)
    let current_hw = get_hardware_fingerprint().map_err(|e| e.to_string())?;
    if trial.hardware_id != current_hw {
        return Err("Trial was started on a different device.".to_string());
    }

    // Check if trial has expired and update status if needed
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    if trial.status == "active" && now >= trial.expires_at {
        trial.status = "expired".to_string();
        // Update integrity hash for the new status
        trial.integrity_hash = Some(trial.calculate_hash());

        // Save updated status
        let json = serde_json::to_string_pretty(&trial).map_err(|e| e.to_string())?;
        tokio::fs::write(&trial_path, json)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(Some(trial))
}

#[tauri::command]
pub async fn activate_license_command(license_code: String) -> Result<ActivatedLicense, String> {
    activate_license(&license_code)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_license_status() -> Result<LicenseStatus, String> {
    // First check if there's an activated license
    match validate_activated_license().await {
        Ok(Some(license)) => {
            return Ok(LicenseStatus::Active {
                email: license.license_data.email,
                tier: license.license_data.tier,
                expires_at: license.license_data.expires_at,
            });
        }
        Ok(None) => {
            // No license, check trial
            let trial_path = get_trial_path().map_err(|e| e.to_string())?;

            if !trial_path.exists() {
                return Ok(LicenseStatus::NeedActivation);
            }

            let contents = tokio::fs::read_to_string(&trial_path)
                .await
                .map_err(|e| e.to_string())?;

            let trial: TrialInfo = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            if now >= trial.expires_at {
                return Ok(LicenseStatus::TrialExpired {
                    started_at: trial.started_at,
                    expired_at: trial.expires_at,
                });
            }

            let remaining_secs = trial.expires_at - now;
            let days_remaining = ((remaining_secs + 86_399) / 86_400) as u32;

            return Ok(LicenseStatus::Trial {
                days_remaining,
                expires_at: trial.expires_at,
            });
        }
        Err(e) => {
            return Ok(LicenseStatus::Invalid {
                reason: e.to_string(),
            });
        }
    }
}

#[tauri::command]
pub async fn deactivate_license() -> Result<(), String> {
    let existing_license = load_activated_license().await.map_err(|e| e.to_string())?;

    let path = get_license_path().map_err(|e| e.to_string())?;

    if let Some(license) = existing_license.as_ref() {
        match get_hardware_fingerprint() {
            Ok(hardware_id) => {
                if let Err(err) =
                    deregister_activation_with_server(&license.license_data.id, &hardware_id).await
                {
                    println!(
                        "[LICENSE] Warning: Failed to deregister activation on server: {}",
                        err
                    );
                }
            }
            Err(err) => {
                println!(
                    "[LICENSE] Warning: Unable to compute hardware fingerprint for deregistration: {}",
                    err
                );
            }
        }
    }

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| e.to_string())?;

        println!("[LICENSE] Deactivated");
    }

    Ok(())
}

/// Request refund for activated license
#[tauri::command]
pub async fn request_refund() -> Result<String, String> {
    // Load activated license
    let license = load_activated_license()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No active license found. Cannot request refund.".to_string())?;

    let email = &license.license_data.email;
    let license_id = &license.license_data.id;

    println!(
        "[REFUND] Requesting refund for license {} ({})",
        license_id, email
    );

    // Call refund API - use localhost in debug mode
    let refund_url = if cfg!(debug_assertions) {
        "http://localhost:3001/refund"
    } else {
        "https://privateai-license-server.onrender.com/refund"
    };

    println!("[REFUND] Using server: {}", refund_url);

    let client = reqwest::Client::new();
    let response = client
        .post(refund_url)
        .json(&serde_json::json!({
            "email": email,
            "licenseId": license_id,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to refund server: {}", e))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refund response: {}", e))?;

    if !status.is_success() {
        let error_msg = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Refund failed: {}", error_msg));
    }

    // Refund successful - add to blacklist and deactivate license locally
    println!("[REFUND] Adding license to revoked blacklist");
    if let Err(e) = add_to_revoked_blacklist(license_id).await {
        println!("[REFUND] Warning: Failed to add to blacklist: {}", e);
    }

    deactivate_license().await?;

    let refund_id = body
        .get("refundId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    println!("[REFUND] Success - Refund ID: {}", refund_id);

    // Create detailed success message for user
    let detailed_message = format!(
        "✓ Refund processed successfully!\n\nYour license has been deactivated and your refund request has been submitted.\n\nRefund ID: {}\n\nPlease allow 5-10 business days for the refund to appear in your account.",
        refund_id
    );

    Ok(detailed_message)
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
pub enum LicenseStatus {
    NeedActivation,
    Trial {
        days_remaining: u32,
        expires_at: i64,
    },
    TrialExpired {
        started_at: i64,
        expired_at: i64,
    },
    Active {
        email: String,
        tier: String,
        expires_at: Option<i64>,
    },
    Invalid {
        reason: String,
    },
}
