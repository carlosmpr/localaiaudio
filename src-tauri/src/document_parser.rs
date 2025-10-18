use anyhow::{Context, Result};
use calamine::{open_workbook_auto, Reader};
use std::fs;
use std::path::Path;

/// Supported document types
#[derive(Debug)]
pub enum DocumentType {
    Pdf,
    Docx,
    Xlsx,
    Text,
    Markdown,
    Code,
}

impl DocumentType {
    /// Detect document type from file extension
    pub fn from_extension(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|ext| ext.to_str())
            .and_then(|ext| match ext.to_lowercase().as_str() {
                "pdf" => Some(DocumentType::Pdf),
                "docx" => Some(DocumentType::Docx),
                "xlsx" | "xls" | "xlsm" | "xlsb" | "ods" => Some(DocumentType::Xlsx),
                "txt" => Some(DocumentType::Text),
                "md" | "markdown" => Some(DocumentType::Markdown),
                // Code file extensions
                "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "java" | "c" | "cpp" | "h" |
                "hpp" | "go" | "rb" | "php" | "swift" | "kt" | "cs" | "html" | "css" |
                "scss" | "json" | "xml" | "yaml" | "yml" | "toml" | "sh" | "bash" |
                "sql" | "r" | "scala" | "lua" | "vim" | "dart" => Some(DocumentType::Code),
                _ => None,
            })
    }
}

/// Extract text from a PDF file
fn extract_pdf(path: &Path) -> Result<String> {
    let text = pdf_extract::extract_text(path)
        .context("Failed to extract text from PDF")?;
    Ok(text)
}

/// Extract text from a DOCX file
fn extract_docx(path: &Path) -> Result<String> {
    // Read the entire file into memory as bytes
    let bytes = fs::read(path)
        .context("Failed to read DOCX file")?;

    let docx = docx_rs::read_docx(&bytes)
        .map_err(|e| anyhow::anyhow!("Failed to parse DOCX: {}", e))?;

    // Extract all text from paragraphs
    let mut text = String::new();

    for child in &docx.document.children {
        if let docx_rs::DocumentChild::Paragraph(para) = child {
            for para_child in &para.children {
                if let docx_rs::ParagraphChild::Run(run) = para_child {
                    for run_child in &run.children {
                        if let docx_rs::RunChild::Text(t) = run_child {
                            text.push_str(&t.text);
                        }
                    }
                }
            }
            text.push('\n');
        }
    }

    Ok(text)
}

/// Extract text from an XLSX/XLS file
fn extract_xlsx(path: &Path) -> Result<String> {
    let mut workbook = open_workbook_auto(path)
        .context("Failed to open spreadsheet file")?;

    let mut text = String::new();

    // Get all sheet names
    let sheet_names = workbook.sheet_names().to_vec();

    for sheet_name in sheet_names {
        if let Ok(range) = workbook.worksheet_range(&sheet_name) {
            text.push_str(&format!("Sheet: {}\n", sheet_name));
            text.push_str(&format!("{}\n", "=".repeat(40)));

            for row in range.rows() {
                let row_text: Vec<String> = row
                    .iter()
                    .map(|cell| format!("{}", cell))
                    .collect();
                text.push_str(&row_text.join("\t"));
                text.push('\n');
            }
            text.push('\n');
        }
    }

    Ok(text)
}

/// Extract text from plain text files (TXT, MD, code files)
fn extract_text_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path)
        .context("Failed to read file")?;

    // Try UTF-8 first
    if let Ok(text) = String::from_utf8(bytes.clone()) {
        return Ok(text);
    }

    // Fall back to encoding detection
    let (cow, _, had_errors) = encoding_rs::UTF_8.decode(&bytes);

    if had_errors {
        // Try common encodings
        let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
        Ok(cow.into_owned())
    } else {
        Ok(cow.into_owned())
    }
}

/// Main function to extract text from any supported document
pub fn extract_document_text(path: &Path) -> Result<String> {
    let doc_type = DocumentType::from_extension(path)
        .ok_or_else(|| anyhow::anyhow!("Unsupported file type"))?;

    match doc_type {
        DocumentType::Pdf => extract_pdf(path),
        DocumentType::Docx => extract_docx(path),
        DocumentType::Xlsx => extract_xlsx(path),
        DocumentType::Text | DocumentType::Markdown | DocumentType::Code => {
            extract_text_file(path)
        }
    }
}

/// Get a summary of the document (file name, type, size, excerpt)
pub fn get_document_summary(path: &Path, text: &str) -> Result<String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let file_size = fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0);

    let doc_type = DocumentType::from_extension(path)
        .map(|t| format!("{:?}", t))
        .unwrap_or_else(|| "Unknown".to_string());

    let char_count = text.chars().count();
    let word_count = text.split_whitespace().count();
    let line_count = text.lines().count();

    // Get first 200 characters as excerpt
    let excerpt: String = text.chars().take(200).collect();
    let excerpt = if text.chars().count() > 200 {
        format!("{}...", excerpt)
    } else {
        excerpt
    };

    Ok(format!(
        "📄 Document: {}\n\
         📊 Type: {}\n\
         💾 Size: {} bytes\n\
         📝 Stats: {} characters, {} words, {} lines\n\
         \n\
         Preview:\n\
         {}\n",
        file_name, doc_type, file_size, char_count, word_count, line_count, excerpt
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_type_detection() {
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.pdf")),
            Some(DocumentType::Pdf)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.docx")),
            Some(DocumentType::Docx)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.xlsx")),
            Some(DocumentType::Xlsx)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.txt")),
            Some(DocumentType::Text)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.md")),
            Some(DocumentType::Markdown)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.rs")),
            Some(DocumentType::Code)
        ));
        assert!(matches!(
            DocumentType::from_extension(Path::new("test.py")),
            Some(DocumentType::Code)
        ));
    }
}
