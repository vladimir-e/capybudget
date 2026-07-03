# Releasing

Capy Budget ships through two channels built from the same sources:

- **Direct download** — Developer-ID-signed, notarized installers (`.dmg`, `.exe`, `.deb`, `.AppImage`) attached to GitHub Releases, plus a Tauri updater manifest (`latest.json`) that drives the in-app auto-updater.
- **Mac App Store** — a sandboxed `.app` uploaded to App Store Connect. A config overlay applied on top of the same sources, not a fork; it leaves the Developer-ID/DMG pipeline untouched.

Both channels report the same marketing version, bumped by `npm run release`.

## Versioning

`npm run release <version>` (`scripts/release.mjs`) is the single entry point for a version bump. It rewrites every version source of truth — `package.json`, `packages/app/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `capybudget` entry in `Cargo.lock` — syncs `package-lock.json`, then commits (`chore: release vX.Y.Z`) and tags `vX.Y.Z`. It refuses to run on a dirty working tree, and both the commit and the tag are idempotent, so a retry after a failed push is safe.

The Mac App Store build carries a second, independent version — the `CFBundleVersion` build number — that App Store Connect requires to climb on every upload. It is unrelated to the marketing version above; see [Build number](#build-number).

## Direct download (GitHub Releases)

Releases are cut from `main` via a tag:

```bash
npm run release 0.2.0      # bumps versions, commits, tags v0.2.0
git push --follow-tags     # triggers the Release workflow (draft only)
```

The `release.yml` workflow builds and signs installers for macOS, Windows, and Linux and attaches them to a **draft** GitHub Release along with the updater manifest (`latest.json`). Promotion is manual — test the draft's artifacts, then publish it from the GitHub UI (or `gh release edit vX.Y.Z --draft=false --latest`). The auto-updater only sees the new version once the release is promoted, since `/releases/latest` skips drafts.

The stable download URLs (used by the website and the auto-updater) always resolve to the newest published release:

- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-macos.dmg`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-windows-x64.exe`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-linux-x64.AppImage`
- `https://github.com/vladimir-e/capybudget/releases/latest/download/capybudget-linux-x64.deb`

**Required repo secrets:**

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key (`tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater key |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | App-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

## Mac App Store

The sandboxed store variant is a config overlay on the same sources. The full local flow is three steps — build the sandboxed `.app`, wrap it in a signed `.pkg`, upload to App Store Connect:

```bash
npm run build:mas        # sandboxed .app (config overlay + `mas` Cargo feature)
npm run package:mas      # .app  → .pkg   (xcrun productbuild)
npm run upload:mas       # .pkg  → App Store Connect (xcrun altool, API key)

npm run release:mas      # build:mas + package:mas in one shot
```

### build:mas

`scripts/build-mas.mjs`:

- applies `src-tauri/tauri.mas.conf.json` on top of `tauri.conf.json` — bundle target `app` only, updater artifacts off, the sandbox entitlements, and the trimmed sandbox-safe `mas` capability set (`src-tauri/capabilities/mas.json`) in place of the default;
- compiles Rust with `--no-default-features --features mas` and the frontend with the `__MAS__` Vite define set to `true`, which excludes the updater, process, and shell-spawn plugins from this variant at compile time (URL-opening and reveal-in-Finder run through `@tauri-apps/plugin-opener` in both builds);
- generates `src-tauri/Entitlements.mas.plist` from `Entitlements.mas.plist.template`, substituting `APPLE_TEAM_ID` and the app identifier;
- stamps `CFBundleVersion` from the [build-number counter](#build-number).

Without the team ID / signing identity / profile it still runs end to end and produces an **unsigned** `.app` (the config path is exercised; codesigning is skipped). Default target is `universal-apple-darwin`; set `MAS_TARGET=aarch64-apple-darwin` for faster local iteration.

### package:mas

`scripts/package-mas.mjs` wraps the built `.app` in an installer with `xcrun productbuild --component <app> /Applications --sign <identity>`, writing `Capy Budget.pkg` next to the `.app`. With `APPLE_INSTALLER_IDENTITY` unset it emits an **unsigned** `.pkg` (loud warning) so the local smoke loop works before certs exist — App Store Connect rejects an unsigned package, but `installer -pkginfo` / `pkgutil --expand` verify the layout.

### upload:mas

`scripts/upload-mas.mjs` sends the signed `.pkg` with `xcrun altool --upload-app --type macos`, authenticated by an App Store Connect **API key** (`.p8`). It fails fast when the credentials, the `.pkg`, or a valid installer signature are missing. On success it bumps the [build-number counter](#build-number). Manual fallback: **Transporter.app** — drag the `.pkg` in and sign in with the same API key. (`altool` remains supported for App Store submission; only its notarization mode was retired, and MAS builds aren't notarized — App Store review handles that.)

### Env / asset matrix

Three *different* certificates plus one API key:

| Var / file | Step | What it is |
| --- | --- | --- |
| `APPLE_TEAM_ID` | build | Team ID, baked into the entitlements. |
| `APPLE_SIGNING_IDENTITY` | build | **Apple Distribution** identity (`Apple Distribution: Name (TEAMID)`) — codesigns the `.app`. Distinct from the Developer-ID identity the DMG build uses. **The DMG flow reads the same var**, so a shell still exporting the Developer-ID value silently signs the MAS `.app` with the wrong cert — unset or override it for MAS builds. |
| `src-tauri/embedded.provisionprofile` | build | Mac App Store provisioning profile for `app.capybudget.desktop`, from the Apple Developer portal. Gitignored; skipped from the bundle when absent. |
| `APPLE_INSTALLER_IDENTITY` | package | **Mac Installer Distribution** identity — signs the `.pkg`. A third, separate certificate. |
| `APPLE_API_KEY_ID` | upload | App Store Connect API key ID. |
| `APPLE_API_ISSUER` | upload | API key issuer UUID. |
| `APPLE_API_KEY_PATH` | upload | Path to the `AuthKey_<id>.p8` private key. |
| `MAS_TARGET` | all | Build target (default `universal-apple-darwin`). |
| `MAS_BUILD_NUMBER` | build | Override the counter for a one-off (see [Build number](#build-number)). |

### Build number

App Store Connect rejects a reused `CFBundleVersion`, so it climbs every upload. The current value lives in checked-in `src-tauri/mas-build-number.txt`: `build:mas` stamps it into the `.app`, and `upload:mas` increments it after a successful upload (commit the bump). Set `MAS_BUILD_NUMBER` to override for a one-off build — then you own the counter. Because the counter is a committed file, `git pull` before building on a second machine: uploading from both the laptop and the mini without pulling the other's bump stamps the same `CFBundleVersion` twice, and App Store Connect rejects the second.

### Store icon

`npm run icon:mas-store` (re)generates `src-tauri/icons/AppStore-1024.png` — the 1024×1024 **no-alpha** icon App Store Connect requires for the listing (uploaded under *App Information*, separate from the bundled `.icns`, which keeps its transparent macOS reps). It's derived from the 1024 representation already inside `icon.icns`; the rounded-corner transparency is filled with the icon's own gradient so the result is fully opaque. Regenerate it whenever the app icon changes.

### Current status

**Still blocked until the certs/profile exist:** real codesigning of the `.app` and `.pkg`, and the actual upload. Everything up to those points works today — the overlay/config path, the unsigned `.app`, an unsigned `.pkg`, the store icon, and every prereq check in `upload:mas`. The first real signed run needs `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY`, `APPLE_INSTALLER_IDENTITY`, `src-tauri/embedded.provisionprofile`, and the three `APPLE_API_*` values.

**CI (not yet wired).** No MAS workflow exists because its secrets (three certs + API key) can't exist yet. When they do, mirror `release.yml`: import the certs into a temporary keychain, run `build:mas` then `package:mas` with the env above, then `upload:mas`. Keep it a separate job from the DMG release so a store push never blocks a GitHub release.
