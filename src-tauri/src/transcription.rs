use anyhow::{Context, Result};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(feature = "whisper-embedded")]
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
}

/// Transcribe audio using Whisper API (http://localhost:9000/v1/audio/transcriptions)
/// This uses the OpenAI-compatible API format that whisper.cpp server provides
pub async fn transcribe_with_api(
    file_path: &str,
    language: Option<String>,
) -> Result<TranscriptionResult> {
    let path = Path::new(file_path);

    if !path.exists() {
        anyhow::bail!("File not found: {}", file_path);
    }

    // Read the file
    let file_bytes = std::fs::read(path)
        .context("Failed to read audio file")?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.mp3");

    // Build multipart form
    let mut form = multipart::Form::new()
        .text("model", "whisper-1")
        .part(
            "file",
            multipart::Part::bytes(file_bytes)
                .file_name(file_name.to_string())
                .mime_str("audio/mpeg")?,
        );

    // Add language if specified
    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    // Send request to Whisper API
    let client = reqwest::Client::new();
    let response = client
        .post("http://localhost:9000/v1/audio/transcriptions")
        .multipart(form)
        .send()
        .await
        .context("Failed to connect to Whisper API. Make sure it's running on http://localhost:9000")?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        anyhow::bail!("Whisper API error ({}): {}", status, error_text);
    }

    let result: TranscriptionResult = response
        .json()
        .await
        .context("Failed to parse transcription response")?;

    Ok(result)
}

/// Transcribe audio using embedded Whisper model
/// This loads a local Whisper model and processes the audio file directly
#[cfg(feature = "whisper-embedded")]
pub fn transcribe_with_embedded(
    file_path: &str,
    model_path: &str,
    language: Option<String>,
) -> Result<TranscriptionResult> {
    let path = Path::new(file_path);

    if !path.exists() {
        anyhow::bail!("File not found: {}", file_path);
    }

    // Load the Whisper model with default parameters
    let ctx = WhisperContext::new_with_params(model_path, whisper_rs::WhisperContextParameters::default())
        .context("Failed to load Whisper model. Make sure the model file exists.")?;

    // Read audio file - whisper-rs expects raw audio data
    // For now, we'll require pre-converted WAV files at 16kHz
    let audio_data = read_audio_file(file_path)?;

    // Create transcription parameters
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // Set language if specified - need to handle lifetime correctly
    let language_str;
    if let Some(ref lang) = language {
        language_str = lang.as_str();
        params.set_language(Some(language_str));
    }

    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // Run the transcription
    let mut state = ctx.create_state()
        .context("Failed to create Whisper state")?;

    state.full(params, &audio_data)
        .context("Failed to run Whisper transcription")?;

    // Extract the transcription text
    let num_segments = state.full_n_segments()
        .context("Failed to get number of segments")?;

    let mut full_text = String::new();
    for i in 0..num_segments {
        let segment = state.full_get_segment_text(i)
            .context("Failed to get segment text")?;
        full_text.push_str(&segment);
        full_text.push(' ');
    }

    Ok(TranscriptionResult {
        text: full_text.trim().to_string(),
    })
}

/// Read and convert audio file to format expected by Whisper
/// For now, this expects 16kHz mono WAV files
#[cfg(feature = "whisper-embedded")]
fn read_audio_file(file_path: &str) -> Result<Vec<f32>> {
    // For MVP, we'll use a simple WAV reader
    // In production, you'd want to use a library like `hound` or `symphonia`
    // to support multiple formats and handle conversion

    use std::fs::File;
    use std::io::Read;

    let mut file = File::open(file_path)
        .context("Failed to open audio file")?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .context("Failed to read audio file")?;

    // Skip WAV header (44 bytes) and convert bytes to f32 samples
    // This is a simplified implementation - proper WAV parsing would be better
    if buffer.len() < 44 {
        anyhow::bail!("Invalid WAV file: too small");
    }

    let audio_bytes = &buffer[44..];
    let mut samples = Vec::with_capacity(audio_bytes.len() / 2);

    for chunk in audio_bytes.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        samples.push(sample as f32 / 32768.0);
    }

    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Only run when Whisper API is actually running
    async fn test_transcribe_api() {
        // This test requires a Whisper API server running on localhost:9000
        // and a test audio file
        let result = transcribe_with_api("test_audio.mp3", Some("en".to_string())).await;
        assert!(result.is_ok());
    }

    #[test]
    #[ignore] // Only run when model file is available
    #[cfg(feature = "whisper-embedded")]
    fn test_transcribe_embedded() {
        // This test requires a Whisper model file and test audio
        let result = transcribe_with_embedded(
            "test_audio.wav",
            "models/ggml-base.en.bin",
            Some("en".to_string())
        );
        assert!(result.is_ok());
    }
}
