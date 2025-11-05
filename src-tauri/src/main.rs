// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local_license;
mod onboarding;
mod transcription;

use tauri::{AppHandle, Manager, WindowBuilder, WindowUrl};
use transcription::TranscriptionResult;

/// Transcribe an audio file using the local Whisper model
#[tauri::command]
async fn transcribe_audio(
    file_path: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    transcription::transcribe_with_api(&file_path, language)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_buy_license_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_window("buy-license") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let external_url = tauri::Url::parse("https://www.the-aideveloper.com/privateai/buy-license")
        .map_err(|error| error.to_string())?;
    let url = WindowUrl::External(external_url);

    let window = WindowBuilder::new(&app_handle, "buy-license", url)
        .title("Buy PrivateAI License")
        .inner_size(1000.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    window.set_focus().map_err(|e| e.to_string())?;

    app_handle
        .emit_all("buy-license-window-opened", ())
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            open_buy_license_window,
            onboarding::check_onboarding_status,
            onboarding::accept_legal_terms,
            onboarding::complete_onboarding,
            onboarding::reset_onboarding,
            local_license::start_trial_command,
            local_license::get_trial_status,
            local_license::activate_license_command,
            local_license::check_license_status,
            local_license::deactivate_license,
            local_license::request_refund,
        ])
        .setup(|app| {
            let app_handle = app.handle();
            tauri::async_runtime::block_on(async move {
                match local_license::check_license_status().await {
                    Ok(status) => {
                        match status {
                            local_license::LicenseStatus::Active { .. } => {
                                println!("[LICENSE] Valid license detected");
                            }
                            local_license::LicenseStatus::Trial { days_remaining, .. } => {
                                println!(
                                    "[LICENSE] Trial active with {} days remaining",
                                    days_remaining
                                );
                            }
                            local_license::LicenseStatus::NeedActivation => {
                                println!("[LICENSE] No license or trial detected");
                            }
                            local_license::LicenseStatus::TrialExpired { .. } => {
                                eprintln!("[LICENSE] Trial has expired - prompting activation");
                                app_handle.emit_all("license-expired", ()).ok();
                            }
                            local_license::LicenseStatus::Invalid { reason } => {
                                eprintln!("[LICENSE] Invalid license detected: {}", reason);
                                app_handle.emit_all("license-expired", ()).ok();
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[LICENSE] Error checking license: {}", e);
                    }
                }
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;

            let app_handle = app.handle();
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(async move {
                    let mut interval =
                        tokio::time::interval(tokio::time::Duration::from_secs(60 * 5));
                    loop {
                        interval.tick().await;

                        match local_license::check_license_status().await {
                            Ok(status) => match status {
                                local_license::LicenseStatus::TrialExpired { .. }
                                | local_license::LicenseStatus::Invalid { .. } => {
                                    eprintln!(
                                        "[LICENSE] Trial expired or license invalid during runtime"
                                    );
                                    app_handle.emit_all("license-expired", ()).ok();
                                }
                                _ => {}
                            },
                            Err(e) => {
                                eprintln!("[LICENSE] Background check error: {}", e);
                            }
                        }
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
