use crate::{CpuInfo, DiskInfo, GpuInfo, HardwareInfo, NetworkInfo};
use sysinfo::System;

pub async fn scan_hardware() -> Result<HardwareInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU information
    let cpus = sys.cpus();
    let cpu = cpus.first().ok_or("No CPU found")?;

    let cpu_info = CpuInfo {
        vendor: cpu.vendor_id().to_string(),
        model: cpu.brand().to_string(),
        physical_cores: sys.physical_core_count().unwrap_or(1),
        logical_cores: cpus.len(),
    };

    // RAM information (convert from bytes to GB)
    let ram_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);

    // GPU information - basic detection
    let gpu = detect_gpu();

    // Disk information
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (total_space, available_space) = disks.iter().fold((0u64, 0u64), |(total, avail), disk| {
        (total + disk.total_space(), avail + disk.available_space())
    });

    let disk_info = DiskInfo {
        free_gb: available_space as f64 / (1024.0 * 1024.0 * 1024.0),
        total_gb: total_space as f64 / (1024.0 * 1024.0 * 1024.0),
    };

    // Network - simple check
    let network_info = NetworkInfo {
        connected: check_network_connection().await,
    };

    let os = format!(
        "{} {}",
        System::name().unwrap_or_default(),
        System::os_version().unwrap_or_default()
    );

    Ok(HardwareInfo {
        os,
        cpu: cpu_info,
        ram_gb,
        gpu,
        disk: disk_info,
        network: network_info,
    })
}

fn detect_gpu() -> Option<GpuInfo> {
    // Try to detect GPU on different platforms
    #[cfg(target_os = "macos")]
    {
        // On macOS, assume Apple Silicon or Intel with integrated GPU
        Some(GpuInfo {
            vendor: "Apple".to_string(),
            model: "Metal GPU".to_string(),
            vram_gb: None,
        })
    }

    #[cfg(target_os = "windows")]
    {
        // Basic Windows GPU detection
        detect_gpu_windows()
    }

    #[cfg(target_os = "linux")]
    {
        // Basic Linux GPU detection
        detect_gpu_linux()
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu_windows() -> Option<GpuInfo> {
    use std::process::Command;

    // Try nvidia-smi first
    if let Ok(output) = Command::new("nvidia-smi")
        .arg("--query-gpu=name,memory.total")
        .arg("--format=csv,noheader")
        .output()
    {
        if output.status.success() {
            if let Ok(result) = String::from_utf8(output.stdout) {
                let parts: Vec<&str> = result.trim().split(',').collect();
                if parts.len() >= 2 {
                    let vram_str = parts[1].trim().replace(" MiB", "");
                    let vram_gb = vram_str.parse::<f64>().ok().map(|mb| mb / 1024.0);

                    return Some(GpuInfo {
                        vendor: "NVIDIA".to_string(),
                        model: parts[0].trim().to_string(),
                        vram_gb,
                    });
                }
            }
        }
    }

    // Fallback to generic GPU
    Some(GpuInfo {
        vendor: "Unknown".to_string(),
        model: "GPU Detected".to_string(),
        vram_gb: None,
    })
}

#[cfg(target_os = "linux")]
fn detect_gpu_linux() -> Option<GpuInfo> {
    use std::process::Command;

    // Try nvidia-smi first
    if let Ok(output) = Command::new("nvidia-smi")
        .arg("--query-gpu=name,memory.total")
        .arg("--format=csv,noheader")
        .output()
    {
        if output.status.success() {
            if let Ok(result) = String::from_utf8(output.stdout) {
                let parts: Vec<&str> = result.trim().split(',').collect();
                if parts.len() >= 2 {
                    let vram_str = parts[1].trim().replace(" MiB", "");
                    let vram_gb = vram_str.parse::<f64>().ok().map(|mb| mb / 1024.0);

                    return Some(GpuInfo {
                        vendor: "NVIDIA".to_string(),
                        model: parts[0].trim().to_string(),
                        vram_gb,
                    });
                }
            }
        }
    }

    // Try lspci for AMD/Intel
    if let Ok(output) = Command::new("lspci").output() {
        if output.status.success() {
            if let Ok(result) = String::from_utf8(output.stdout) {
                for line in result.lines() {
                    if line.contains("VGA") || line.contains("3D") {
                        return Some(GpuInfo {
                            vendor: "Unknown".to_string(),
                            model: line.to_string(),
                            vram_gb: None,
                        });
                    }
                }
            }
        }
    }

    None
}

async fn check_network_connection() -> bool {
    // Simple network check with timeout
    match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::net::lookup_host("google.com:80"),
    )
    .await
    {
        Ok(Ok(_)) => true,
        _ => false, // Timeout or error
    }
}
