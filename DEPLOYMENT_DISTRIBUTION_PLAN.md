# Deployment & Distribution Plan

## Activation & Licensing
- Gate every installation behind a license service that issues machine-bound activation tokens signed by the backend.
- Bind tokens to a hardware fingerprint (CPU, motherboard, OS UUID) and store them in the platform keychain/secure storage; refuse to run if the signature or fingerprint mismatches.
- Limit active devices per license; require revocation of the old fingerprint before allowing a new activation.

## Packaging & Asset Protection
- Ship application bundles with encrypted AI models/python assets; decrypt only after the license check passes and keep decrypted data in memory or ephemeral directories.
- Apply platform code-signing (macOS notarization, Windows Authenticode, Linux GPG signatures) so tampered packages fail verification and cannot launch.
- Embed watermark strings and versioned manifests in assets to trace leaks and detect unauthorized builds.

## Runtime Enforcement
- On every startup, validate the local license token (signature freshness, hardware hash, expiry). If validation fails, lock access to models and prompt for purchase or support.
- Implement low-frequency telemetry pings (purchase ID + hashed fingerprint) to confirm legitimate activations and flag suspicious patterns such as multiple geographies or rapid reinstalls.
- Detect trial abuse by monitoring system clock tampering (monotonic timer comparisons) and repeated installs with identical hardware identifiers.

## Trial-to-Paid Flow
- Issue a signed 7-day trial token at first launch; bind it to the hardware fingerprint and install timestamp and automatically expire it without network access.
- After trial expiry, disable model loading until a paid activation is supplied; provide a guided upgrade flow inside the app.
- Surface remaining trial time and purchase CTAs throughout the UI to encourage conversion before the lockout triggers.

## Legal & Policy Coverage
- Present an End User License Agreement, purchase terms, and redistribution clause during installation and first run; capture acceptance with timestamp + license ID.
- Document prohibited actions (redistribution, key sharing, reverse engineering) and escalate violations through your support/legal processes.
- Version and archive every policy update; include change notices within the app for returning users.

## Operational Controls
- Maintain a revocation endpoint to blacklist leaked or abused keys; the app should check revocation status during routine validation pings.
- Run regular audits of activation logs to spot anomalies (e.g., simultaneous usage of one license across multiple locations).
- Monitor public channels for cracked copies using package hashes/watermarks and prepare takedown playbooks with legal counsel.

## Release Checklist
1. Sign and notarize platform-specific bundles; generate checksums and publish alongside downloads.
2. Encrypt embedded assets and update the manifest signature used by runtime integrity checks.
3. Deploy updated license service schemas (activation, trial issuance, revocation) before shipping the new build.
4. QA the onboarding: fresh install → trial flow → lockout → paid activation → revalidation.
5. Announce release notes with reminders about licensing terms and support channels for activation issues.
