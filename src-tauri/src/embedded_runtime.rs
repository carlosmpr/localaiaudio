use crate::conversation::ConversationMessage;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

#[cfg(feature = "runtime-embedded")]
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{
        params::LlamaModelParams, AddBos, LlamaChatMessage, LlamaModel, Special,
    },
    sampling::LlamaSampler,
};

#[derive(Default)]
pub struct EmbeddedRuntimeState {
    #[cfg(feature = "runtime-embedded")]
    model: Arc<Mutex<Option<LlamaModel>>>,
    #[cfg(feature = "runtime-embedded")]
    backend: Arc<Mutex<Option<LlamaBackend>>>,
    model_path: Arc<Mutex<Option<PathBuf>>>,
    pub cancel_generation: Arc<Mutex<bool>>,
}

#[derive(Debug, Serialize, Clone)]
struct StreamPayload {
    content: String,
}

impl EmbeddedRuntimeState {
    pub fn new() -> Self {
        Self {
            #[cfg(feature = "runtime-embedded")]
            model: Arc::new(Mutex::new(None)),
            #[cfg(feature = "runtime-embedded")]
            backend: Arc::new(Mutex::new(None)),
            model_path: Arc::new(Mutex::new(None)),
            cancel_generation: Arc::new(Mutex::new(false)),
        }
    }
}

#[cfg(feature = "runtime-embedded")]
pub async fn load_model(
    model_path: String,
    state: tauri::State<'_, EmbeddedRuntimeState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    use tokio::task;

    let path = PathBuf::from(&model_path);

    if !path.exists() {
        return Err(format!("Model file not found: {}", model_path));
    }

    app_handle
        .emit_all("model-load-status", "Initializing llama.cpp backend...")
        .ok();

    // Run blocking operations in a separate thread
    let path_clone = path.clone();
    let result = task::spawn_blocking(move || {
        // Initialize backend
        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to init backend: {e}"))?;

        // Load model
        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, &path_clone, &model_params)
            .map_err(|e| format!("Failed to load model: {e}"))?;

        Ok::<_, String>((backend, model))
    }).await
    .map_err(|e| format!("Task join error: {e}"))??;

    let (backend, model) = result;

    app_handle
        .emit_all("model-load-status", "Storing model in state...")
        .ok();

    // Store in state
    {
        let mut backend_guard = state.backend.lock().await;
        *backend_guard = Some(backend);
    }
    {
        let mut model_guard = state.model.lock().await;
        *model_guard = Some(model);
    }
    {
        let mut path_guard = state.model_path.lock().await;
        *path_guard = Some(path.clone());
    }

    app_handle
        .emit_all("model-load-status", "Model loaded successfully")
        .ok();

    Ok(path.display().to_string())
}

#[cfg(not(feature = "runtime-embedded"))]
pub async fn load_model(
    _model_path: String,
    _state: tauri::State<'_, EmbeddedRuntimeState>,
    _app_handle: AppHandle,
) -> Result<String, String> {
    Err("Embedded runtime not enabled. Build with --features runtime-embedded".into())
}

#[cfg(feature = "runtime-embedded")]
pub async fn chat_with_model(
    prompt: String,
    history: Vec<ConversationMessage>,
    state: tauri::State<'_, EmbeddedRuntimeState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    use std::num::NonZeroU32;

    println!("[DEBUG] chat_with_model called with prompt: {}", &prompt[..prompt.len().min(50)]);
    println!("[DEBUG] History length: {}", history.len());

    // Reset cancellation flag at the start of generation
    {
        let mut cancel_flag = state.cancel_generation.lock().await;
        *cancel_flag = false;
    }

    let model_guard = state.model.lock().await;
    let model = model_guard.as_ref()
        .ok_or_else(|| "Model not loaded. Call load_model first.".to_string())?;

    // Create context with 8192 tokens (Gemma 2 2B supports up to 8192)
    // This allows for long conversations with sliding window attention
    // n_batch must be large enough to handle the prompt + history in one go
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(8192))
        .with_n_batch(8192);

    let backend_guard = state.backend.lock().await;
    let backend = backend_guard.as_ref()
        .ok_or_else(|| "Backend not initialized".to_string())?;

    let mut ctx = model.new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {e}"))?;

    // Format prompt using the model's native chat template when available to avoid manual prompt hacks.
    let (formatted_prompt, add_bos) = match model.chat_template(None) {
        Ok(template) => {
            let mut chat_messages = Vec::with_capacity(history.len());
            for msg in &history {
                chat_messages
                    .push(LlamaChatMessage::new(msg.role.clone(), msg.content.clone())
                    .map_err(|e| format!("Invalid chat message: {e}"))?);
            }

            let prompt = model
                .apply_chat_template(&template, &chat_messages, true)
                .map_err(|e| format!("Failed to apply chat template: {e}"))?;

            (prompt, AddBos::Never)
        }
        Err(err) => {
            println!(
                "[WARN] Chat template unavailable ({err:?}); falling back to basic formatting."
            );
            let mut fallback_prompt = String::new();
            for msg in &history {
                let role = msg.role.as_str();
                match role {
                    "user" => fallback_prompt.push_str(&format!("User: {}\n", msg.content)),
                    "assistant" => {
                        fallback_prompt.push_str(&format!("Assistant: {}\n", msg.content))
                    }
                    other => fallback_prompt.push_str(&format!("{other}: {}\n", msg.content)),
                }
            }
            fallback_prompt.push_str("Assistant:");
            (fallback_prompt, AddBos::Always)
        }
    };

    println!(
        "[DEBUG] Formatted prompt (truncated): {}",
        &formatted_prompt[..formatted_prompt.len().min(200)]
    );

    // Tokenize the final prompt
    let tokens = model
        .str_to_token(&formatted_prompt, add_bos)
        .map_err(|e| format!("Tokenization failed: {e}"))?;

    if tokens.is_empty() {
        return Err("Tokenization produced no tokens".into());
    }

    // Process tokens - use larger batch size to handle long conversations
    let mut batch = LlamaBatch::new(8192, 1);
    let tokens_len = tokens.len();
    for (i, &token) in tokens.iter().enumerate() {
        // Set logits=true for the last token so we can generate from it
        let is_last = i == tokens_len - 1;
        batch.add(token, i as i32, &[0], is_last)
            .map_err(|e| format!("Failed to add token: {e}"))?;
    }

    ctx.decode(&mut batch)
        .map_err(|e| format!("Failed to decode: {e}"))?;

    println!("[DEBUG] Batch decoded successfully, starting generation loop");

    // Generate response
    let mut accumulated = String::new();
    let max_tokens = 4096;  // Maximum generation length - allows very long responses
    let mut n_past = tokens_len as i32;

    println!("[DEBUG] Starting generation with max_tokens={}, n_past={}", max_tokens, n_past);

    for i in 0..max_tokens {
        // Check if generation was cancelled (non-blocking check)
        if let Ok(cancel_flag) = state.cancel_generation.try_lock() {
            if *cancel_flag {
                println!("[DEBUG] Generation cancelled by user at iteration {}", i);
                break;
            }
        }

        // For the first iteration, logits are at the last position of the initial batch
        // For subsequent iterations, logits are at position 0 (single token batch)
        let logit_idx = if i == 0 { batch.n_tokens() - 1 } else { 0 };

        let mut candidates = ctx.token_data_array_ith(logit_idx);

        // Simple sampling without repetition penalty - just temperature and top-p for natural output
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),        // Keep top 40 most likely tokens
            LlamaSampler::top_p(0.95, 1),   // Nucleus sampling: keep tokens that sum to 95% probability
            LlamaSampler::min_p(0.05, 1),   // Filter out very low probability tokens
            LlamaSampler::temp(0.8),        // Temperature: balance between creative and coherent
            LlamaSampler::dist(42),         // Sample from distribution with fixed seed for consistency
        ]);

        candidates.apply_sampler(&mut sampler);
        let new_token = candidates.selected_token()
            .ok_or_else(|| "Sampling failed to select a token".to_string())?;

        if new_token == model.token_eos() {
            println!("[DEBUG] Reached EOS token at iteration {}", i);
            break;
        }

        let token_str = model
            .token_to_str(new_token, Special::Tokenize)
            .map_err(|e| format!("Failed to convert token: {e}"))?;

        if token_str == "<end_of_turn>" {
            println!("[DEBUG] Reached end_of_turn token at iteration {}", i);
            break;
        }

        accumulated.push_str(&token_str);

        if i < 5 || i % 50 == 0 {
            println!("[DEBUG] Token {}: '{}', accumulated length: {}", i, token_str, accumulated.len());
        }

        // Emit streaming update with controlled frequency to prevent overwhelming the UI
        // Only emit every 5 tokens or on last token to balance smoothness and performance
        if i % 5 == 0 || i == max_tokens - 1 {
            app_handle
                .emit_all("chat-stream", StreamPayload {
                    content: accumulated.clone(),
                })
                .ok();
        }

        // Add token to batch for next iteration
        batch.clear();

        // Check if we're about to exceed context limit
        if n_past >= 8192 {
            println!("[WARN] Reached context limit at {} tokens, stopping generation", n_past);
            accumulated.push_str("\n\n[Context limit reached. Please start a new conversation.]");
            break;
        }

        batch.add(new_token, n_past, &[0], true)
            .map_err(|e| {
                if e.to_string().contains("Insufficient") {
                    format!("Context window full ({} tokens). Please start a new conversation to continue.", n_past)
                } else {
                    format!("Failed to add token: {e}")
                }
            })?;

        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode: {e}"))?;

        n_past += 1;
    }

    println!("[DEBUG] Generation loop completed. Total accumulated: {} chars", accumulated.len());

    app_handle
        .emit_all("embedded-stream-done", "")
        .ok();

    println!("[DEBUG] Emitted embedded-stream-done event");

    Ok(())
}

#[cfg(not(feature = "runtime-embedded"))]
pub async fn chat_with_model(
    _prompt: String,
    _history: Vec<ConversationMessage>,
    _state: tauri::State<'_, EmbeddedRuntimeState>,
    _app_handle: AppHandle,
) -> Result<(), String> {
    Err("Embedded runtime not enabled. Build with --features runtime-embedded".into())
}

pub async fn unload_model(state: tauri::State<'_, EmbeddedRuntimeState>) -> Result<String, String> {
    #[cfg(feature = "runtime-embedded")]
    {
        let mut model_guard = state.model.lock().await;
        *model_guard = None;

        let mut backend_guard = state.backend.lock().await;
        *backend_guard = None;
    }

    let mut path_guard = state.model_path.lock().await;
    *path_guard = None;

    Ok("Model unloaded".into())
}
