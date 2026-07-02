fn main() {
    // tauri-build validates every capability file it globs against the compiled
    // plugin set. The MAS build drops the updater/process/shell plugins, so the
    // desktop `default.json` (which grants them) can't resolve there — scope MAS
    // to just the sandboxed `mas.json`. The default build keeps the standard
    // `./capabilities/**/*` glob via the unchanged `build()` path.
    if std::env::var_os("CARGO_FEATURE_MAS").is_some() {
        println!("cargo:rerun-if-changed=capabilities");
        tauri_build::try_build(
            tauri_build::Attributes::new().capabilities_path_pattern("./capabilities/mas.json"),
        )
        .expect("failed to run tauri-build for the MAS variant");
    } else {
        tauri_build::build()
    }
}
