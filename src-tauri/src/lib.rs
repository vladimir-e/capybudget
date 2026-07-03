#[cfg(all(feature = "mas", target_os = "macos"))]
mod security_scope;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(feature = "shell-spawn")]
    let builder = builder.plugin(tauri_plugin_shell::init());

    #[cfg(all(desktop, feature = "updater"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(all(feature = "mas", target_os = "macos"))]
    let builder = builder
        .manage(security_scope::ScopedAccess::default())
        .setup(|app| {
            security_scope::restore_folder_access(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            security_scope::persist_folder_access,
            security_scope::forget_folder_access,
            security_scope::reconcile_folder_access,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
