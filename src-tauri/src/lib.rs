//! The keito desktop app: the web app in a window, with boards kept in a folder on this machine.

mod commands;
mod store;

use commands::Boards;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Set once the page has written what it had: quitting may go ahead.
static WRITTEN: AtomicBool = AtomicBool::new(false);

/// When quitting was last asked for, in milliseconds since the app started.
static ASKED: AtomicU64 = AtomicU64::new(0);
/// Whether the page has heard the last request to quit (and is writing what it has).
static HEARD: AtomicBool = AtomicBool::new(false);

/// The page has heard the request to quit: it writes what it has, then calls `quit`.
#[tauri::command]
fn quit_heard() {
    HEARD.store(true, Ordering::SeqCst);
}

/// Ask the page to write what it has and quit. Asked again within a few seconds and never heard,
/// the app quits anyway: a page that cannot answer (it failed to load) must not keep it open.
fn ask_to_quit(app: &AppHandle) -> bool {
    let now = START.elapsed().as_millis() as u64 + 1;
    let before = ASKED.swap(now, Ordering::SeqCst);
    if before != 0 && now - before < 4_000 && !HEARD.load(Ordering::SeqCst) {
        WRITTEN.store(true, Ordering::SeqCst);
        app.exit(0);
        return false;
    }
    HEARD.store(false, Ordering::SeqCst);
    let _ = app.emit("quit-requested", ());
    true
}

static START: std::sync::LazyLock<std::time::Instant> = std::sync::LazyLock::new(std::time::Instant::now);

/// The page has written what it had (or the user let it go): quit now.
#[tauri::command]
fn quit(app: AppHandle) {
    WRITTEN.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// The menu bar: the app's own menu (with 設定…), editing (so ⌘C / ⌘V reach text fields), reloading, the window.
fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, "settings", "設定…", true, Some("CmdOrCtrl+,"))?;
    // Quitting is the app's own, not the system's: the page writes what it has first.
    let quit = MenuItem::with_id(app, "quit", "keito を終了", true, Some("CmdOrCtrl+Q"))?;
    let keito = Submenu::with_items(
        app,
        "keito",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("keito について"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("keito を隠す"))?,
            &PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?,
            &PredefinedMenuItem::show_all(app, Some("すべてを表示"))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    // Undo and redo are the board's own (⌘Z on the board), not the text system's: they stay out.
    let edit = Submenu::with_items(
        app,
        "編集",
        true,
        &[&PredefinedMenuItem::cut(app, Some("カット"))?, &PredefinedMenuItem::copy(app, Some("コピー"))?, &PredefinedMenuItem::paste(app, Some("ペースト"))?, &PredefinedMenuItem::select_all(app, Some("すべてを選択"))?],
    )?;
    // Reloading is the page's own too: it writes what it has before it goes.
    let reload = MenuItem::with_id(app, "reload", "再読み込み", true, Some("CmdOrCtrl+R"))?;
    let view = Submenu::with_items(app, "表示", true, &[&reload])?;
    let window = Submenu::with_items(
        app,
        "ウインドウ",
        true,
        &[&PredefinedMenuItem::minimize(app, Some("しまう"))?, &PredefinedMenuItem::fullscreen(app, Some("フルスクリーン"))?, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::close_window(app, Some("閉じる"))?],
    )?;
    Menu::with_items(app, &[&keito, &edit, &view, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("keito-asset", |ctx, request| commands::serve_asset(ctx.app_handle(), request))
        .invoke_handler(tauri::generate_handler![
            commands::boards_folder,
            commands::set_boards_folder,
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
            commands::pick_save,
            commands::pick_open,
            commands::pick_folder,
            commands::open_for_print,
            quit,
            quit_heard,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            // The folder is made once it is decided: the default waits for the user's say on first launch.
            let (root, source) = commands::boards_root(app.handle());
            if source != commands::Source::Default {
                std::fs::create_dir_all(&root)?;
            }
            app.manage(Boards::new(root, source));
            commands::watch(app.handle().clone());
            app.set_menu(menu(app.handle())?)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit("open-settings", ());
                }
                "quit" => {
                    ask_to_quit(app);
                }
                "reload" => {
                    let _ = app.emit("reload-requested", ());
                }
                _ => {}
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building keito");
    app.run(|app, event| {
        // Quitting (⌘Q, the menu) waits for the page to write what it has; it then calls `quit`.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            if !WRITTEN.load(Ordering::SeqCst) && ask_to_quit(app) {
                api.prevent_exit();
            }
        }
    });
}
