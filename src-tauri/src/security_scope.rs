// Security-scoped bookmarks for the sandboxed Mac App Store build.
//
// Under App Sandbox the app may only touch user-selected paths, and that grant
// dies with the process. To reopen a budget on the next launch without a fresh
// dialog we persist an app-scoped NSURL security-scoped bookmark per granted
// folder (requires the com.apple.security.files.bookmarks.app-scope
// entitlement), then on startup resolve each bookmark to re-grant OS access.
//
// Invariant: any budget folder with active OS access holds a recursive Tauri
// fs-ACL grant (`path/**`), and this module is its sole owner — persist grants it
// on pick, restore grants it on relaunch (both via grant_fs_scope). The narrow
// MAS capability leaves the static fs scope empty, and the dialog's implicit
// grant on pick is only `path` + `path/*`, too shallow for a budget's nested
// writes (e.g. .capy/import/sources/) — so we never rely on it.
//
// Neither Tauri core nor the fs/persisted-scope plugins implement macOS
// security-scoped bookmarks (tauri#3716 open; fs `startAccessingSecurityScoped`
// is iOS-only; persisted-scope restores only glob patterns), so this is
// hand-rolled via objc2.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

const STORE_FILE: &str = "folder-bookmarks.json";
const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// path -> base64 bookmark. Ordered so the on-disk file is stable.
type Store = BTreeMap<String, String>;

/// Holds resolved security-scoped URLs keyed by the path they were resolved for,
/// so they stay alive for the process (access ends when the URL deallocates) and
/// so forget/reconcile can stop accessing a specific folder.
#[derive(Default)]
pub struct ScopedAccess {
    active: Mutex<HashMap<String, Retained<NSURL>>>,
}

// ── pure store logic (no Tauri, no FFI) ──────────────────────────────────────

fn read_store_at(path: &Path) -> Store {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_store_at(path: &Path, store: &Store) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write to a temp sibling then rename: a crash mid-write can't leave a
    // truncated file, which read_store_at would silently degrade to an empty
    // map — dropping every grant.
    let tmp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn paths_to_drop(store: &Store, keep: &[String]) -> Vec<String> {
    store
        .keys()
        .filter(|p| !keep.iter().any(|k| k == *p))
        .cloned()
        .collect()
}

// ── objc2 bookmark primitives ────────────────────────────────────────────────

fn create_bookmark_for_url(url: &NSURL) -> Result<String, String> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("bookmark creation failed: {e:?}"))?;
    Ok(B64.encode(data.to_vec()))
}

fn create_bookmark(path: &str) -> Result<String, String> {
    create_bookmark_for_url(&NSURL::fileURLWithPath(&NSString::from_str(path)))
}

/// Resolve a bookmark and begin accessing it. Returns the live URL and whether
/// macOS reported the bookmark as stale.
fn resolve_bookmark(bookmark: &str) -> Result<(Retained<NSURL>, bool), String> {
    let bytes = B64.decode(bookmark).map_err(|e| e.to_string())?;
    let data = NSData::with_bytes(&bytes);
    let mut stale = Bool::new(false);
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut stale,
        )
    }
    .map_err(|e| format!("bookmark resolution failed: {e:?}"))?;
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return Err("startAccessingSecurityScopedResource returned false".into());
    }
    Ok((url, stale.as_bool()))
}

// ── Tauri glue ───────────────────────────────────────────────────────────────

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(STORE_FILE))
        .map_err(|e| e.to_string())
}

/// Stop accessing the given paths and drop them from the live set.
fn stop_access<R: Runtime>(app: &AppHandle<R>, paths: &[String]) {
    let state = app.state::<ScopedAccess>();
    let mut active = state.active.lock().unwrap();
    for path in paths {
        if let Some(url) = active.remove(path) {
            unsafe { url.stopAccessingSecurityScopedResource() };
        }
    }
}

/// Grant the recursive Tauri fs-ACL for a budget folder — the module's single
/// owner of that grant, shared by persist (pick) and restore (relaunch).
fn grant_fs_scope<R: Runtime>(app: &AppHandle<R>, path: &str) {
    if let Some(scope) = app.try_fs_scope() {
        let _ = scope.allow_directory(path, true);
    }
}

/// Record a bookmark for a user-granted folder so access survives relaunch, and
/// grant its fs-ACL so this session's writes work too (see the module invariant).
#[tauri::command]
pub fn persist_folder_access<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    // Grant before the fallible bookmark work: the JS caller swallows errors,
    // so a bookmark failure must not leave this session with shallow scope.
    grant_fs_scope(&app, &path);
    let bookmark = create_bookmark(&path)?;
    let store_file = store_path(&app)?;
    let mut store = read_store_at(&store_file);
    store.insert(path, bookmark);
    write_store_at(&store_file, &store)
}

/// Drop a folder's bookmark and release its access (called when the user forgets
/// a recent budget).
#[tauri::command]
pub fn forget_folder_access<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let store_file = store_path(&app)?;
    let mut store = read_store_at(&store_file);
    if store.remove(&path).is_some() {
        write_store_at(&store_file, &store)?;
    }
    stop_access(&app, std::slice::from_ref(&path));
    Ok(())
}

/// Prune bookmarks for folders the UI no longer tracks. Called at boot and after
/// each open with the current recents so the store can't grow unbounded and we
/// don't re-grant folders the user can't see. `keep` is the set to retain.
#[tauri::command]
pub fn reconcile_folder_access<R: Runtime>(
    app: AppHandle<R>,
    keep: Vec<String>,
) -> Result<(), String> {
    let store_file = store_path(&app)?;
    let mut store = read_store_at(&store_file);
    let drop = paths_to_drop(&store, &keep);
    if drop.is_empty() {
        return Ok(());
    }
    for path in &drop {
        store.remove(path);
    }
    write_store_at(&store_file, &store)?;
    stop_access(&app, &drop);
    Ok(())
}

/// On startup, re-establish access to every bookmarked folder at both layers:
/// the OS sandbox (resolve + start accessing) and the Tauri fs ACL (allow the
/// resolved location in the runtime scope). Folders that fail to resolve (moved
/// beyond the bookmark, deleted, unmounted) are left in the store — they may
/// resolve on a later launch; meanwhile the JS boot flow degrades to the
/// selector's re-open prompt. Stale bookmarks are re-minted from the resolved
/// URL (Apple's guidance), not the stored path string.
pub fn restore_folder_access<R: Runtime>(app: &AppHandle<R>) {
    let Ok(store_file) = store_path(app) else {
        return;
    };
    let store = read_store_at(&store_file);
    if store.is_empty() {
        return;
    }

    let state = app.state::<ScopedAccess>();
    let mut active = state.active.lock().unwrap();
    let mut refreshed = store.clone();
    let mut changed = false;

    for (path, bookmark) in &store {
        let Ok((url, stale)) = resolve_bookmark(bookmark) else {
            continue;
        };
        let resolved = url.path().map(|p| p.to_string());
        grant_fs_scope(app, resolved.as_deref().unwrap_or(path));
        if stale {
            if let Ok(fresh) = create_bookmark_for_url(&url) {
                refreshed.insert(path.clone(), fresh);
                changed = true;
            }
        }
        active.insert(path.clone(), url);
    }

    if changed {
        let _ = write_store_at(&store_file, &refreshed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("capy-ss-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn store_roundtrips_through_disk() {
        let path = temp_dir("roundtrip").join(STORE_FILE);
        let mut store = Store::new();
        store.insert("/Users/x/Budget".into(), "Ym9va21hcms=".into());
        store.insert("/Volumes/ext/Money".into(), "ZGF0YQ==".into());
        write_store_at(&path, &store).unwrap();
        assert_eq!(read_store_at(&path), store);
    }

    #[test]
    fn write_store_leaves_no_temp_file() {
        let path = temp_dir("atomic").join(STORE_FILE);
        write_store_at(&path, &Store::new()).unwrap();
        assert!(path.exists());
        assert!(!path.with_extension("tmp").exists());
    }

    #[test]
    fn read_missing_or_corrupt_store_is_empty() {
        assert!(read_store_at(Path::new("/no/such/capy/store.json")).is_empty());
        let path = temp_dir("corrupt").join(STORE_FILE);
        std::fs::write(&path, "{ this is not json").unwrap();
        assert!(read_store_at(&path).is_empty());
    }

    #[test]
    fn paths_to_drop_returns_only_unkept() {
        let mut store = Store::new();
        for p in ["/a", "/b", "/c"] {
            store.insert(p.into(), "x".into());
        }
        assert_eq!(
            paths_to_drop(&store, &["/b".into(), "/z".into()]),
            vec!["/a".to_string(), "/c".to_string()],
        );
        assert!(paths_to_drop(&store, &["/a".into(), "/b".into(), "/c".into()]).is_empty());
    }

    #[test]
    fn base64_bookmark_bytes_roundtrip() {
        let raw: &[u8] = &[0, 1, 2, 255, b'b', b'm', b'k'];
        assert_eq!(B64.decode(B64.encode(raw)).unwrap(), raw);
    }
}
