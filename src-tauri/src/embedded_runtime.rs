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
        println!("[INFO] Detecting hardware configuration...");

        // Detect system capabilities - this ensures compatibility across different Macs
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            if let Ok(output) = Command::new("sysctl")
                .args(&["-n", "hw.memsize"])
                .output()
            {
                if let Ok(mem_str) = String::from_utf8(output.stdout) {
                    if let Ok(total_mem) = mem_str.trim().parse::<u64>() {
                        let total_gb = total_mem / (1024 * 1024 * 1024);
                        println!("[INFO] Detected {} GB total RAM", total_gb);
                    }
                }
            }

            if let Ok(output) = Command::new("sysctl")
                .args(&["-n", "machdep.cpu.brand_string"])
                .output()
            {
                if let Ok(cpu) = String::from_utf8(output.stdout) {
                    println!("[INFO] CPU: {}", cpu.trim());
                }
            }
        }

        println!("[INFO] Initializing llama.cpp backend with automatic hardware detection...");

        // Initialize backend - llama.cpp will automatically detect and use Metal on Apple Silicon
        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to init backend: {e}"))?;

        println!("[INFO] Loading model with adaptive parameters...");

        // Load model with default parameters - llama.cpp handles hardware adaptation
        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, &path_clone, &model_params)
            .map_err(|e| format!("Failed to load model: {e}"))?;

        println!("[INFO] Model loaded successfully with hardware-optimized settings");

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

    // Use large context window - model supports 128k, we'll use 120k with frontend managing it
    let (n_ctx, n_batch) = {
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            // Try to detect available memory
            if let Ok(output) = Command::new("sysctl").args(&["-n", "hw.memsize"]).output() {
                if let Ok(mem_str) = String::from_utf8(output.stdout) {
                    if let Ok(total_mem) = mem_str.trim().parse::<u64>() {
                        let total_gb = total_mem / (1024 * 1024 * 1024);

                        // Use maximum context - frontend handles trimming automatically
                        // Model supports 128k, use 120k to leave buffer for response
                        let context_size = if total_gb >= 16 {
                            println!("[INFO] High RAM detected ({}GB), using full 120k context window", total_gb);
                            120000
                        } else if total_gb >= 8 {
                            println!("[INFO] Medium RAM detected ({}GB), using 60k context window", total_gb);
                            60000
                        } else {
                            println!("[INFO] Lower RAM detected ({}GB), using 30k context window", total_gb);
                            30000
                        };

                        (context_size, 8192) // Keep batch size at 8k for efficiency
                    } else {
                        println!("[WARN] Could not parse memory, using safe default 60k");
                        (60000, 8192)
                    }
                } else {
                    println!("[WARN] Could not read memory info, using safe default 60k");
                    (60000, 8192)
                }
            } else {
                println!("[WARN] sysctl not available, using safe default 60k");
                (60000, 8192)
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            println!("[INFO] Non-macOS system, using default 60k token context");
            (60000, 8192)
        }
    };

    println!("[INFO] Creating context with n_ctx={}, n_batch={}", n_ctx, n_batch);

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx as u32))
        .with_n_batch(n_batch as u32);

    let backend_guard = state.backend.lock().await;
    let backend = backend_guard.as_ref()
        .ok_or_else(|| "Backend not initialized".to_string())?;

    let mut ctx = model.new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {e}"))?;

    println!("[INFO] Context created successfully");

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

    let tokens_len = tokens.len();
    println!("[INFO] Prompt tokenized to {} tokens (context capacity: {})", tokens_len, n_ctx);

    // CRITICAL: Check if prompt exceeds KV cache capacity BEFORE attempting to decode
    // This prevents the NoKvCacheSlot error that crashes the app
    if tokens_len >= n_ctx {
        let error_msg = format!(
            "Context overflow: Prompt requires {} tokens but context limit is {} tokens. \
             The frontend should have cleaned up old messages automatically.",
            tokens_len, n_ctx
        );
        println!("[ERROR] {}", error_msg);

        // Emit user-friendly error to frontend
        app_handle
            .emit_all("chat-stream", StreamPayload {
                content: format!("⚠️ **Context Cleanup Needed**\n\n\
                    The conversation has grown too large ({} tokens).\n\n\
                    Please start a new conversation to continue.\n\n\
                    *(Auto-cleanup attempted but context is still too full)*",
                    tokens_len),
            })
            .ok();

        app_handle
            .emit_all("embedded-stream-done", "")
            .ok();

        return Err(error_msg);
    }

    // Warn if we're approaching capacity (85% full)
    let capacity_threshold = (n_ctx as f32 * 0.85) as usize;
    if tokens_len >= capacity_threshold {
        let warning_msg = format!(
            "⚠️ Context usage high: {}/{} tokens ({}%). Auto-cleanup will activate soon.",
            tokens_len, n_ctx, (tokens_len as f32 / n_ctx as f32 * 100.0) as u32
        );
        println!("[WARN] {}", warning_msg);

        app_handle
            .emit_all("chat-status", warning_msg.clone())
            .ok();
    }

    // Process tokens - use batch size that fits within context window
    let batch_size = n_ctx.min(8192);
    let mut batch = LlamaBatch::new(batch_size, 1);

    for (i, &token) in tokens.iter().enumerate() {
        // Set logits=true for the last token so we can generate from it
        let is_last = i == tokens_len - 1;
        batch.add(token, i as i32, &[0], is_last)
            .map_err(|e| format!("Failed to add token to batch: {e}"))?;
    }

    // Decode the initial prompt
    ctx.decode(&mut batch)
        .map_err(|e| {
            // Better error message for KV cache issues
            if e.to_string().contains("NoKvCacheSlot") || e.to_string().contains("slot") {
                format!("KV cache exhausted during prompt processing. Context: {}/{} tokens used. \
                        Start a new conversation or reduce message history.",
                        tokens_len, n_ctx)
            } else {
                format!("Failed to decode prompt: {e}")
            }
        })?;

    println!("[DEBUG] Batch decoded successfully, starting generation loop");

    // Generate response with proper context management
    let mut accumulated = String::new();

    // Calculate safe generation limit: reserve space for prompt + response
    // Leave 10% buffer for safety
    let remaining_tokens = n_ctx.saturating_sub(tokens_len);
    let safe_buffer = (remaining_tokens as f32 * 0.1) as usize;
    let max_generation_tokens = remaining_tokens.saturating_sub(safe_buffer).min(4096);

    let mut n_past = tokens_len as i32;

    println!(
        "[INFO] Starting generation: prompt={} tokens, context_capacity={}, max_generation={}, n_past={}",
        tokens_len, n_ctx, max_generation_tokens, n_past
    );

    // Early exit if no room for generation
    if max_generation_tokens < 10 {
        let error_msg = "Context is too full to generate a response. Please start a new conversation.";
        println!("[ERROR] {}", error_msg);

        app_handle
            .emit_all("chat-stream", StreamPayload {
                content: format!("⚠️ {}", error_msg),
            })
            .ok();

        app_handle
            .emit_all("embedded-stream-done", "")
            .ok();

        return Err(error_msg.into());
    }

    for i in 0..max_generation_tokens {
        // Check if generation was cancelled (non-blocking check)
        if let Ok(cancel_flag) = state.cancel_generation.try_lock() {
            if *cancel_flag {
                println!("[DEBUG] Generation cancelled by user at iteration {}", i);
                break;
            }
        }

        // Safety check: ensure we haven't exceeded context capacity
        if n_past as usize >= n_ctx {
            println!("[WARN] Context capacity reached at {} tokens, stopping generation", n_past);
            accumulated.push_str("\n\n⚠️ *Context limit reached. Start a new conversation to continue.*");
            break;
        }

        // For the first iteration, logits are at the last position of the initial batch
        // For subsequent iterations, logits are at position 0 (single token batch)
        let logit_idx = if i == 0 { batch.n_tokens() - 1 } else { 0 };

        let mut candidates = ctx.token_data_array_ith(logit_idx);

        // Sampling with repeat penalty to prevent loops - works identically across all hardware
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::penalties(64, 1.15, 0.0, 0.0), // Repeat penalty: look back 64 tokens, 1.15 penalty
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
        if i % 5 == 0 || i == max_generation_tokens - 1 {
            app_handle
                .emit_all("chat-stream", StreamPayload {
                    content: accumulated.clone(),
                })
                .ok();
        }

        // Add token to batch for next iteration
        batch.clear();

        batch.add(new_token, n_past, &[0], true)
            .map_err(|e| {
                if e.to_string().contains("Insufficient") || e.to_string().contains("slot") {
                    format!("Context window exhausted ({}/{} tokens). Start a new conversation.", n_past, n_ctx)
                } else {
                    format!("Failed to add token to batch: {e}")
                }
            })?;

        // Decode next token with improved error handling
        ctx.decode(&mut batch)
            .map_err(|e| {
                if e.to_string().contains("NoKvCacheSlot") || e.to_string().contains("slot") {
                    format!("KV cache exhausted at token {} (context {}/{}). Start a new conversation.",
                            n_past, n_past, n_ctx)
                } else {
                    format!("Failed to decode token: {e}")
                }
            })?;

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
