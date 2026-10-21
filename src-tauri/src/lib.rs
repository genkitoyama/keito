//! The keito desktop app: the web app in a window, with boards kept in a folder on this machine.

mod commands;
mod store;

use commands::Boards;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("keito-asset", |ctx, request| commands::serve_asset(ctx.app_handle(), request))
        .invoke_handler(tauri::generate_handler![
            commands::boards_folder,
            commands::list_boards,
            commands::load_board,
            commands::save_board,
            commands::remove_board,
            commands::trashed_boards,
            commands::restore_board,
            commands::load_revision,
            commands::save_revision,
            commands::remove_revision,
            commands::put_asset,
            commands::load_presets,
            commands::save_presets,
            commands::write_file,
            commands::read_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let root = commands::boards_root(app.handle());
            std::fs::create_dir_all(&root)?;
            app.manage(Boards::new(root));
            commands::watch(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running keito");
}
