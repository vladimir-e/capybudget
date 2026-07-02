// Security-scoped bookmarks for the sandboxed Mac App Store build.
//
// Under App Sandbox the app may only touch user-selected paths, and that grant
// dies with the process. To reopen a budget on the next launch without a fresh
// dialog we persist an NSURL security-scoped bookmark per granted folder, then
// on startup resolve each bookmark (re-granting OS access) and re-add its path
// to the fs plugin's runtime scope (re-granting the Tauri ACL, which the narrow
// MAS capability leaves empty and the dialog otherwise fills per session).
//
// Neither Tauri core nor the fs/persisted-scope plugins implement macOS
// security-scoped bookmarks (tauri#3716 open; fs `startAccessingSecurityScoped`
// is iOS-only; persisted-scope restores only glob patterns), so this is
// hand-rolled via objc2.

use std::collections::BTreeMap;
use std::path::PathBuf;
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

/// Holds resolved security-scoped URLs for the process lifetime — access ends
/// when the URL is deallocated, so they must stay alive until the app quits.
#[derive(Default)]
pub struct ScopedAccess {
    active: Mutex<Vec<Retained<NSURL>>>,
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

fn read_store<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, String> {
    store_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_store<R: Runtime>(app: &AppHandle<R>, store: &BTreeMap<String, String>) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Create a security-scoped bookmark for a path the process can currently reach
/// (freshly picked via the dialog, or already being accessed), returned base64.
fn create_bookmark(path: &str) -> Result<String, String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("bookmark creation failed: {e:?}"))?;
    Ok(B64.encode(data.to_vec()))
}

/// Resolve a bookmark and begin accessing it. Returns the live URL (the caller
/// keeps it alive) and whether macOS reported the bookmark as stale.
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

/// Record a bookmark for a user-granted folder so access survives relaunch.
#[tauri::command]
pub fn persist_folder_access<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let bookmark = create_bookmark(&path)?;
    let mut store = read_store(&app);
    store.insert(path, bookmark);
    write_store(&app, &store)
}

/// Drop a folder's bookmark (called when the user forgets a recent budget).
#[tauri::command]
pub fn forget_folder_access<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let mut store = read_store(&app);
    if store.remove(&path).is_some() {
        write_store(&app, &store)?;
    }
    Ok(())
}

/// On startup, re-establish access to every bookmarked folder at both layers:
/// the OS sandbox (resolve + start accessing) and the Tauri fs ACL (allow in the
/// runtime scope). Folders that fail to resolve (moved, deleted, unmounted) are
/// left in the store — they may resolve on a later launch; meanwhile the JS boot
/// flow degrades to the selector's re-open prompt.
pub fn restore_folder_access<R: Runtime>(app: &AppHandle<R>) {
    let store = read_store(app);
    if store.is_empty() {
        return;
    }

    let scope = app.try_fs_scope();
    let state = app.state::<ScopedAccess>();
    let mut active = state.active.lock().unwrap();
    let mut refreshed = store.clone();
    let mut changed = false;

    for (path, bookmark) in &store {
        let Ok((url, stale)) = resolve_bookmark(bookmark) else {
            continue;
        };
        if let Some(scope) = &scope {
            let _ = scope.allow_directory(path, true);
        }
        if stale {
            if let Ok(fresh) = create_bookmark(path) {
                refreshed.insert(path.clone(), fresh);
                changed = true;
            }
        }
        active.push(url);
    }

    if changed {
        let _ = write_store(app, &refreshed);
    }
}
