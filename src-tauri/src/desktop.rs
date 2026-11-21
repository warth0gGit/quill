//! Quill on the desktop: the quick capture window, the Ctrl+Alt+Space
//! shortcut, the tray icon and starting with Windows.
//!
//! Quill keeps running in the background when its window is closed, so the
//! shortcut works at any time. The tray icon opens it again or quits it.
//! On first run Quill sets itself to start (quietly, in the tray) when you
//! sign in; "Start with Windows" in the File menu turns that off.

use std::fs;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

pub const CAPTURE: &str = "capture";
pub const MAIN: &str = "main";
pub const SHORTCUT: &str = "ctrl+alt+space";
/// Passed by Windows when Quill starts at sign-in: start in the tray, not on screen.
pub const BACKGROUND_ARG: &str = "--background";
const CAPTURE_W: f64 = 500.0;
const CAPTURE_H: f64 = 280.0;

/// Show Quill's main window and bring it to the front.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The quick capture window, made once and then shown and hidden.
fn capture_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(CAPTURE) {
        return Some(w);
    }
    WebviewWindowBuilder::new(app, CAPTURE, WebviewUrl::App("capture.html".into()))
        .title("Quick capture")
        .inner_size(CAPTURE_W, CAPTURE_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(true)
        .build()
        .ok()
}

/// Ctrl+Alt+Space: show the capture window on the screen the mouse is on,
/// a little above the middle. Pressing it again while it's up hides it.
pub fn toggle_capture(app: &AppHandle) {
    let Some(w) = capture_window(app) else { return };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.emit_to(CAPTURE, "capture://hide", ());
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let area = m.work_area();
        let scale = m.scale_factor();
        let (w_px, h_px) = (CAPTURE_W * scale, CAPTURE_H * scale);
        let x = area.position.x as f64 + (area.size.width as f64 - w_px) / 2.0;
        let y = area.position.y as f64 + (area.size.height as f64 - h_px) * 0.32;
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    } else {
        let _ = w.center();
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit_to(CAPTURE, "capture://open", ());
}

pub fn shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut: &Shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_capture(app);
            }
        })
        .build()
}

/// Claim Ctrl+Alt+Space. If another app already has it, Quill still starts;
/// quick capture is then only in the tray menu.
pub fn register_shortcut(app: &AppHandle) -> bool {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    match app.global_shortcut().register(SHORTCUT) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("Quill: couldn't claim {SHORTCUT}: {e}");
            false
        }
    }
}

/// Make the capture window now (hidden), so the first Ctrl+Alt+Space is instant.
pub fn prepare_capture(app: &AppHandle) {
    let _ = capture_window(app);
}

/// The tray icon: click to open Quill; right-click for New page, Quick
/// capture and Quit.
pub fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Quill", true, None::<&str>)?;
    let new_page = MenuItem::with_id(app, "new", "New page", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture\tCtrl+Alt+Space", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Quill", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &new_page, &capture, &sep, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("quill")
        .tooltip("Quill")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "new" => {
                show_main(app);
                let _ = app.emit_to(MAIN, "quill://new-page", ());
            }
            "capture" => toggle_capture(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Quit for real: let the page save first, then exit (after 3 seconds at
/// the latest, in case the page doesn't answer).
pub fn quit(app: &AppHandle) {
    let _ = app.emit_to(MAIN, "quill://quit", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        app.exit(0);
    });
}

/// On first run, set Quill to start when you sign in. After that the File
/// menu's choice is left alone.
pub fn first_run_autostart(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join("autostart-chosen");
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(&marker, "on");
    }
}

pub fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn set_autostart(app: &AppHandle, on: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let result = if on { manager.enable() } else { manager.disable() };
    result.map_err(|e| format!("Couldn't change starting with Windows: {e}"))?;
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("autostart-chosen"), if on { "on" } else { "off" });
    }
    Ok(autostart_enabled(app))
}
