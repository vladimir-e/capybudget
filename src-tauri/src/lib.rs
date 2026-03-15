#[tauri::command]
fn send_sigint(pid: u32) -> Result<(), String> {
    let ret = unsafe { libc::kill(pid as i32, libc::SIGINT) };
    if ret == 0 {
        Ok(())
    } else {
        Err(format!("Failed to send SIGINT to pid {pid}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![send_sigint])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
