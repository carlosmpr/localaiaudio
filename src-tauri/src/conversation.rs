use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tokio::{fs, io::AsyncWriteExt};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatRecord {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationSummary {
    pub session_id: String,
    pub title: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    pub message_count: usize,
    #[serde(default)]
    pub preview: Option<String>,
}

fn sanitize_session_id(session_id: &str) -> String {
    let mut sanitized = String::with_capacity(session_id.len());
    for ch in session_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    if sanitized.is_empty() {
        "session".into()
    } else {
        sanitized
    }
}

fn session_file(chats_dir: &Path, session_id: &str) -> PathBuf {
    let file_name = format!("{}.jsonl", sanitize_session_id(session_id));
    chats_dir.join(file_name)
}

pub async fn append_records(
    chats_dir: &Path,
    session_id: &str,
    records: &[ChatRecord],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }

    fs::create_dir_all(chats_dir).await.map_err(|e| {
        format!(
            "Failed to create chats directory {}: {e}",
            chats_dir.display()
        )
    })?;

    let file_path = session_file(chats_dir, session_id);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .await
        .map_err(|e| format!("Failed to open chat history {}: {e}", file_path.display()))?;

    for record in records {
        let line = serde_json::to_string(record)
            .map_err(|e| format!("Failed to serialise chat record: {e}"))?;
        file.write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write chat record: {e}"))?;
        file.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalise chat record: {e}"))?;
    }

    Ok(())
}

pub async fn load_records(
    chats_dir: &Path,
    session_id: &str,
    limit: Option<usize>,
) -> Result<Vec<ChatRecord>, String> {
    let file_path = session_file(chats_dir, session_id);

    let data = match fs::read_to_string(&file_path).await {
        Ok(content) => content,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(format!(
                "Failed to read chat history {}: {e}",
                file_path.display()
            ))
        }
    };

    let mut records = Vec::new();
    for line in data.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<ChatRecord>(line) {
            Ok(record) => records.push(record),
            Err(e) => {
                eprintln!("Failed to parse chat record line: {e}");
            }
        }
    }

    if let Some(limit) = limit {
        if records.len() > limit {
            records = records.split_off(records.len() - limit);
        }
    }

    Ok(records)
}

fn make_title(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return "New chat".into();
    }
    let mut title = trimmed
        .lines()
        .next()
        .unwrap_or(trimmed)
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if trimmed.len() > title.len() {
        title.push('…');
    }
    title
}

fn make_preview(source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }
    let preview = trimmed
        .lines()
        .next()
        .unwrap_or(trimmed)
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    Some(preview)
}

pub async fn list_conversations(chats_dir: &Path) -> Result<Vec<ConversationSummary>, String> {
    let mut summaries = Vec::new();

    let mut dir = match fs::read_dir(chats_dir).await {
        Ok(dir) => dir,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(format!(
                "Failed to read chats directory {}: {e}",
                chats_dir.display()
            ))
        }
    };

    while let Some(entry) = dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to iterate chats directory: {e}"))?
    {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        if path
            .extension()
            .and_then(OsStr::to_str)
            .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
            != Some(true)
        {
            continue;
        }

        let Some(file_stem) = path.file_stem().and_then(OsStr::to_str) else {
            continue;
        };

        let session_id = file_stem.to_string();
        let records = load_records(chats_dir, &session_id, None).await?;

        if records.is_empty() {
            summaries.push(ConversationSummary {
                session_id,
                title: "New chat".into(),
                created_at: None,
                updated_at: None,
                message_count: 0,
                preview: None,
            });
            continue;
        }

        let created_at = records.iter().find_map(|r| r.timestamp.clone());
        let updated_at = records.iter().rev().find_map(|r| r.timestamp.clone());
        let first_user = records
            .iter()
            .find(|r| r.role.eq_ignore_ascii_case("user") && !r.content.trim().is_empty())
            .map(|r| make_title(&r.content))
            .unwrap_or_else(|| "New chat".into());
        let preview = records
            .iter()
            .rev()
            .find(|r| !r.content.trim().is_empty())
            .and_then(|r| make_preview(&r.content));

        summaries.push(ConversationSummary {
            session_id,
            title: first_user,
            created_at,
            updated_at,
            message_count: records.len(),
            preview,
        });
    }

    summaries.sort_by(|a, b| match (&a.updated_at, &b.updated_at) {
        (Some(a_ts), Some(b_ts)) => b_ts.cmp(a_ts),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.session_id.cmp(&b.session_id),
    });

    Ok(summaries)
}

pub fn resolve_chats_dir(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(dir) = custom {
        let path = PathBuf::from(dir);
        if path.exists() && !path.is_dir() {
            return Err(format!("{} is not a directory", path.display()));
        }
        return Ok(path);
    }

    let base = crate::storage::get_base_dir_blocking()?;
    Ok(base.join("Chats"))
}

pub async fn delete_conversation(
    chats_dir: &Path,
    session_id: &str,
) -> Result<(), String> {
    let file_path = session_file(chats_dir, session_id);

    match fs::remove_file(&file_path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => {
            // File doesn't exist, consider it success
            Ok(())
        }
        Err(e) => Err(format!(
            "Failed to delete conversation {}: {}",
            file_path.display(),
            e
        )),
    }
}
