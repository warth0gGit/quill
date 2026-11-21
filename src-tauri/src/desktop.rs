//! Quill on the desktop: the quick capture window and the Ctrl+Alt+Space
//! shortcut, which works while Quill is open (or minimised).

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

pub const CAPTURE: &str = "capture";
pub const MAIN: &str = "main";
pub const SHORTCUT: &str = "ctrl+alt+space";
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
