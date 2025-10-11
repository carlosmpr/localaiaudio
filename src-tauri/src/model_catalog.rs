use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelDownload {
    pub url: String,
    #[serde(rename = "checksumSha256")]
    pub checksum_sha256: String,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelCatalogEntry {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub provider: String,
    #[serde(rename = "sizeGb")]
    pub size_gb: f64,
    #[serde(rename = "minRamGb")]
    pub min_ram_gb: f64,
    #[serde(rename = "minVramGb")]
    pub min_vram_gb: f64,
    #[serde(rename = "diskGb")]
    pub disk_gb: f64,
    pub quality: String,
    pub description: String,
    #[serde(rename = "licenseUrl")]
    pub license_url: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub download: Option<ModelDownload>,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    models: Vec<ModelCatalogEntry>,
}

pub fn load_catalog() -> Result<Vec<ModelCatalogEntry>, String> {
    let raw = include_str!("../model_catalog.json");
    let parsed: CatalogFile =
        serde_json::from_str(raw).map_err(|e| format!("Failed to parse model catalog: {e}"))?;
    Ok(parsed.models)
}
