// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod transcription;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
