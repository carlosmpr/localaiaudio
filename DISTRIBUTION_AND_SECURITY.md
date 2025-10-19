# Distribution & Security Plan

## Context Snapshot
- Tauri 1.5 application (`src-tauri/Cargo.toml`) with embedded Rust commands, Node/React UI (`package.json`), and bundled Python scripts and models (`tauri.conf.json` resources).
- Target output: signed desktop bundles for macOS, Windows, and Linux with offline-first AI models.
- Key crates already present: `sysinfo` (hardware inspection), `reqwest` (online validation), `serde`/`serde_json` (config handling) — leverage them for gating logic.

## Distribution Strategy
- **Primary channel:** Direct downloads from a controlled portal; host notarised `.dmg`, `.msi`, `.AppImage/.deb` along with checksum and signature files.
- **Update delivery:** Embed an auto-updater with code-signature verification (Tauri updater or custom). Require license validation before applying updates.
- **Mirrors / fallback:** Provide an offline installer image for enterprise clients with pre-generated activation files.
- **App store evaluation:** macOS App Store and Microsoft Store add friction for bundled models; keep as stretch goal once licensing/encryption strategy is proven.

## Build Hardening Tasks
- Tighten Tauri allowlist by scoping `fs` and `path` access only to app directories; review any shell invocation.
- Use the `tauri.conf.json > bundle` section to enforce app sandboxing and notarisation requirements (macOS notarization, Windows Authenticode signing, Linux GPG signatures).
- Integrate `tauri-plugin-log` and `tracing` sanitisation to avoid leaking PII in logs; rotate or encrypt sensitive logs.
- Ship checksums for `python` and `Models` resource folders; validate at runtime to detect tampering.

## System Requirement Verification
- **Pre-install checks:** Wrap installers (`create_installer_dmg.sh`, Windows equivalent) with prerequisite scripts that verify OS version, architecture, CPU vector support (AVX/NEON), RAM, free disk space, and GPU acceleration configuration.
- **First launch gate:** Add a Rust command leveraging `sysinfo` to run a diagnostic before initialisation; persist results in app state and block the UI if minimum specs are not met.
- **Hardware profiles:** Offer a CLI (`allow-app.sh`) or GUI wizard for power users to profile hardware and recommend suitable models before installation completes.

## Purchase Enforcement Blueprint
- **Common flow:** (1) User creates/uses account → (2) System requirement check → (3) License/trial validation → (4) Decrypt and load models.
- **Secure key storage:** Store activation material in platform keychains (macOS Keychain, Windows Credential Manager, Linux Secret Service) via a Tauri plugin; never leave plaintext keys on disk.
- **Offline safeguard:** Derive machine-specific license fingerprints (CPU + motherboard + OS UUID) and embed checksums in an encrypted token file.

### Option A – Account Sign-In
- Use the existing backend (`newappbackend` or cloud API) to issue OAuth/JWT tokens.
- Pros: revocable, supports subscriptions, central usage analytics.
- Cons: requires network; must offer offline disaster-recovery path.

### Option B – Activation Code + Hardware Bind
- Generate short-lived activation codes redeemed inside the app; exchange for a signed license file tied to machine fingerprint.
- Pros: Works offline after activation; easy reseller distribution.
- Cons: Requires secure license generation service and revocation handling.

### Option C – Managed Distribution (MDM/Enterprise)
- Provide MSI/PKG with embedded license profile curated per organisation, protected by installer signing and checksum.
- Pros: Seamless enterprise rollout; centralized control.
- Cons: Overhead to manage per-org packages.

## Trial & Conversion Plan
- **7-day trial implementation:** Create an encrypted usage ledger storing install timestamp and a signed trial token. On launch, verify token integrity and remaining days; after expiry, block model loading and present purchase workflow.
- **Fraud prevention:** Detect system clock tampering (compare with monotonic timers, optional network time). Limit reinstalls by recording activation events server-side.
- **Conversion prompts:** Configure in-app messaging to surface remaining trial days, CTA for purchase, and allow manual license redemption.
- **Grace modes:** Offer temporary offline grace if license server unreachable; log events for audit.

## Legal & Compliance Deliverables
- **EULA (End User License Agreement):** Focus on model usage rights, redistribution limits, trial restrictions. Surface during first run and in installer dialogs.
- **Terms of Service:** Cover account usage, subscription rules, acceptable use, refund policy.
- **Privacy Policy:** Detail local processing, telemetry controls, and data retention. Provide opt-in/out UI and honour regulatory requirements (GDPR/CCPA).
- **Purchase Agreement:** Automate emailed receipts and include license scope.
- **Recordkeeping:** Version every policy, track acceptance timestamps tied to user/license ID, and store in backend for audits.

## Protecting Embedded Assets
- Package models inside encrypted archives decrypted after license validation; use streaming decryption to avoid leaving cleartext copies.
- Monitor integrity on launch by hashing model directories and comparing to signed manifests.
- Obfuscate or minimise sensitive Python scripts to reduce reverse engineering; consider Rust-native replacements for security-critical paths.
- Audit third-party binaries bundled under `python` or `Models` for licensing compatibility.

## Operational Security & Telemetry
- Implement anomaly detection for repeated offline activations or trial resets.
- Provide a secure support channel for activation issues; log license events with trace IDs (no user content).
- Maintain SBOM (Software Bill of Materials) for Rust, Node, and Python components; automate vulnerability scans before releases.

## Roadmap
- Phase 1: Finalise policies, implement installer pre-checks, tighten Tauri allowlist, add logging safeguards.
- Phase 2: Build activation service (choose Option A/B), integrate 7-day trial flow, encrypt model assets, implement license storage.
- Phase 3: Add auto-update with signature validation, enterprise distribution pipelines, telemetry dashboards.
- Phase 4: Penetration test the full flow, rehearse key revocation + user support playbooks, and document disaster recovery.

## Next Actions
- Select preferred purchase enforcement option and define backend requirements.
- Draft legal documents with counsel; wire them into installer + first-run consent dialogs.
- Schedule implementation tasks in repo (Rust commands, frontend gating UI, installer scripts) and align with release timeline.
