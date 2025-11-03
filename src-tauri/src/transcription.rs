use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
}

/// Get the FFmpeg binary path (bundled or system)
fn get_ffmpeg_path() -> String {
    // Try to find bundled FFmpeg in common resource locations
    // Check current directory first (dev mode)
    let dev_ffmpeg = std::env::current_dir()
        .ok()
        .and_then(|p| {
            let ffmpeg = p.join("binaries/macos/ffmpeg-aarch64-apple-darwin");
            if ffmpeg.exists() {
                Some(ffmpeg)
            } else {
                None
            }
        });

    if let Some(path) = dev_ffmpeg {
        println!("[INFO] Using bundled FFmpeg (dev): {}", path.display());
        return path.to_string_lossy().to_string();
    }

    // Try parent directory (when running from src-tauri)
    let parent_ffmpeg = std::env::current_dir()
        .ok()
        .and_then(|p| {
            let ffmpeg = p.parent()?.join("binaries/macos/ffmpeg-aarch64-apple-darwin");
            if ffmpeg.exists() {
                Some(ffmpeg)
            } else {
                None
            }
        });

    if let Some(path) = parent_ffmpeg {
        println!("[INFO] Using bundled FFmpeg: {}", path.display());
        return path.to_string_lossy().to_string();
    }

    // Fall back to system FFmpeg
    println!("[INFO] Using system FFmpeg");
    "ffmpeg".to_string()
}

/// Convert audio file to WAV format (16kHz mono) using FFmpeg
/// Supports MP3, MP4, M4A, OGG, FLAC, and other common audio formats
fn convert_to_wav(input_path: &str) -> Result<String> {
    println!("[INFO] Converting audio to WAV format (16kHz mono)...");

    // Create temporary output path
    let temp_dir = std::env::temp_dir();
    let file_name = Path::new(input_path)
        .file_stem()
        .unwrap_or_else(|| std::ffi::OsStr::new("audio"))
        .to_string_lossy();
    let output_path = temp_dir.join(format!("{}_converted.wav", file_name));
    let output_path_str = output_path.to_string_lossy().to_string();

    println!("[INFO] Input: {}", input_path);
    println!("[INFO] Output: {}", output_path_str);

    // Get FFmpeg path (bundled or system)
    let ffmpeg_path = get_ffmpeg_path();

    // Run FFmpeg to convert audio
    // -i: input file
    // -ar 16000: sample rate 16kHz
    // -ac 1: mono (1 channel)
    // -y: overwrite output file
    let status = Command::new(&ffmpeg_path)
        .args(&[
            "-i", input_path,
            "-ar", "16000",
            "-ac", "1",
            "-y",
            &output_path_str
        ])
        .status()
        .context("Failed to run FFmpeg. The bundled FFmpeg may be missing or corrupted.")?;

    if !status.success() {
        anyhow::bail!("FFmpeg conversion failed. Please check if the audio file is valid.");
    }

    println!("[INFO] Audio conversion successful");
    Ok(output_path_str)
}

/// Transcribe audio using embedded Whisper model
/// This loads a local Whisper GGUF model and processes the audio file directly
/// Automatically converts non-WAV files to WAV format
pub async fn transcribe_with_api(
    file_path: &str,
    language: Option<String>,
) -> Result<TranscriptionResult> {
    // For now, use the bundled model path
    // In production, this could be configurable
    let model_path = get_default_model_path()?;

    // Check if we need to convert the audio file
    let file_path_to_use = if file_path.to_lowercase().ends_with(".wav") {
        // Already WAV, use as-is
        file_path.to_string()
    } else {
        // Convert to WAV first
        println!("[INFO] Non-WAV file detected, converting to WAV format...");
        convert_to_wav(file_path)?
    };

    let result = transcribe_with_embedded(&file_path_to_use, &model_path, language).await;

    // Clean up temporary converted file if it was created
    if file_path_to_use != file_path {
        let _ = std::fs::remove_file(&file_path_to_use);
        println!("[INFO] Cleaned up temporary WAV file");
    }

    result
}

/// Get the default Whisper model path (bundled with the app)
fn get_default_model_path() -> Result<String> {
    // Try to find the bundled model
    // Using whisper-large-v3 for improved accuracy
    // In production build: should be in the resources folder

    // First try: absolute path (for development on macOS) - using correct GGML format
    let absolute_path = "/Volumes/Carlos/private/localaiAudio/Models/voice/ggml-large-v3.bin";
    if std::path::Path::new(absolute_path).exists() {
        println!("[INFO] Found model at absolute path: {}", absolute_path);
        return Ok(absolute_path.to_string());
    }

    // Second try: current directory + Models/voice/ggml-large-v3.bin
    if let Some(cwd) = std::env::current_dir().ok() {
        let model = cwd.join("Models/voice/ggml-large-v3.bin");
        if model.exists() {
            println!("[INFO] Found model at: {}", model.display());
            return Ok(model.to_string_lossy().to_string());
        }
    }

    // Third try: parent directory (for dev mode when running from src-tauri)
    if let Some(cwd) = std::env::current_dir().ok() {
        if let Some(parent) = cwd.parent() {
            let model = parent.join("Models/voice/ggml-large-v3.bin");
            if model.exists() {
                println!("[INFO] Found model at: {}", model.display());
                return Ok(model.to_string_lossy().to_string());
            }
        }
    }

    // Fourth try: home directory relative path
    if let Some(home) = std::env::var("HOME").ok() {
        let model = std::path::PathBuf::from(home).join("private/localaiAudio/Models/voice/ggml-large-v3.bin");
        if model.exists() {
            println!("[INFO] Found model at: {}", model.display());
            return Ok(model.to_string_lossy().to_string());
        }
    }

    anyhow::bail!("Whisper model not found. Tried:\n  - {}\n  - Current dir + Models/voice/ggml-large-v3.bin\n  - Parent dir + Models/voice/ggml-large-v3.bin\n  - $HOME/private/localaiAudio/Models/voice/ggml-large-v3.bin\n\nPlease ensure ggml-large-v3.bin is in Models/voice/", absolute_path)
}

/// Transcribe audio using embedded Whisper model
async fn transcribe_with_embedded(
    file_path: &str,
    model_path: &str,
    language: Option<String>,
) -> Result<TranscriptionResult> {
    let file_path = file_path.to_string();
    let model_path = model_path.to_string();

    // Run the blocking Whisper operations in a separate thread
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&file_path);

        if !path.exists() {
            anyhow::bail!("Audio file not found: {}", file_path);
        }

        println!("[INFO] Loading Whisper model from: {}", model_path);

        // Load the Whisper model
        let ctx = WhisperContext::new_with_params(
            &model_path,
            WhisperContextParameters::default()
        )
        .context("Failed to load Whisper model. Make sure the model file exists and is a valid GGUF file.")?;

        println!("[INFO] Model loaded successfully");
        println!("[INFO] Reading audio file: {}", file_path);

        // Read audio file - expects 16kHz mono WAV
        let audio_data = read_audio_file(&file_path)?;

        println!("[INFO] Audio loaded: {} samples", audio_data.len());

        // Create transcription parameters
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Set language if specified
        let language_str: Option<String> = language.clone();
        if let Some(ref lang) = language_str {
            params.set_language(Some(lang.as_str()));
            println!("[INFO] Using language: {}", lang);
        } else {
            // Auto-detect language
            params.set_language(None);
            println!("[INFO] Auto-detecting language");
        }

        params.set_print_special(false);
        params.set_print_progress(true);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_translate(false);

        println!("[INFO] Starting transcription...");

        // Create state and run transcription
        let mut state = ctx.create_state()
            .context("Failed to create Whisper state")?;

        state.full(params, &audio_data)
            .context("Failed to run Whisper transcription")?;

        // Extract the transcription text
        let num_segments = state.full_n_segments()
            .context("Failed to get number of segments")?;

        println!("[INFO] Transcription complete. Segments: {}", num_segments);

        let mut full_text = String::new();
        for i in 0..num_segments {
            let segment = state.full_get_segment_text(i)
                .context("Failed to get segment text")?;
            full_text.push_str(&segment);
            if i < num_segments - 1 {
                full_text.push(' ');
            }
        }

        println!("[INFO] Transcription result: {} characters", full_text.len());

        Ok(TranscriptionResult {
            text: full_text.trim().to_string(),
        })
    })
    .await
    .context("Transcription task failed")?
}

/// Read and convert audio file to format expected by Whisper
/// Expects 16kHz mono WAV files (should already be converted by convert_to_wav)
fn read_audio_file(file_path: &str) -> Result<Vec<f32>> {
    // Check if file exists first
    if !std::path::Path::new(file_path).exists() {
        anyhow::bail!("Audio file not found: {}", file_path);
    }

    let mut reader = hound::WavReader::open(file_path)
        .context("Failed to open WAV file. The file may be corrupted or not a valid WAV file.")?;

    let spec = reader.spec();

    // Log audio specs for debugging
    println!("[INFO] Audio format: {} Hz, {} channels, {} bits",
             spec.sample_rate, spec.channels, spec.bits_per_sample);

    // Note: We don't strictly enforce mono/16kHz here since convert_to_wav handles it
    // But we'll still warn if something's off
    if spec.channels != 1 {
        println!("[WARN] Audio has {} channels, expected 1 (mono)", spec.channels);
    }

    if spec.sample_rate != 16000 {
        println!("[WARN] Audio sample rate is {} Hz, expected 16000 Hz", spec.sample_rate);
    }

    // Convert samples to f32 in range [-1.0, 1.0]
    let samples: Result<Vec<f32>> = match spec.sample_format {
        hound::SampleFormat::Int => {
            match spec.bits_per_sample {
                16 => {
                    reader
                        .samples::<i16>()
                        .map(|s| s.map(|sample| sample as f32 / 32768.0))
                        .collect::<Result<Vec<f32>, _>>()
                        .context("Failed to read audio samples")
                }
                32 => {
                    reader
                        .samples::<i32>()
                        .map(|s| s.map(|sample| sample as f32 / 2147483648.0))
                        .collect::<Result<Vec<f32>, _>>()
                        .context("Failed to read audio samples")
                }
                _ => anyhow::bail!("Unsupported bit depth: {}. Please use 16-bit WAV.", spec.bits_per_sample),
            }
        }
        hound::SampleFormat::Float => {
            reader
                .samples::<f32>()
                .collect::<Result<Vec<f32>, _>>()
                .context("Failed to read audio samples")
        }
    };

    samples
}
