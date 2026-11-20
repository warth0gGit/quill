//! Quill's native side: owns the library folder on disk.
//!
//! The library lives in `Documents\Quill`. Every document is one readable
//! `.html` file. New pages land in `Documents\Quill\Inbox`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Couldn't find your Documents folder: {e}"))?;
    Ok(docs.join("Quill"))
}

fn ensure_library(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = library_root(app)?;
    fs::create_dir_all(root.join("Inbox"))
        .map_err(|e| format!("Couldn't create the Quill library folder: {e}"))?;
    Ok(root)
}

/// File names come from the app, but are checked anyway: a plain name ending
/// in .html, with no path separators, so nothing can be written outside the Inbox.
fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name.ends_with(".html")
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
        && name != ".html"
}

/// Write to a temporary file first, then move it into place, so a crash or
/// power cut never leaves a half-written document.
fn write_atomically(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("html.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[tauri::command]
fn library_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(ensure_library(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_document(app: tauri::AppHandle, file_name: String, contents: String) -> Result<(), String> {
    if !valid_file_name(&file_name) {
        return Err(format!("Refused to save an unexpected file name: {file_name}"));
    }
    let path = ensure_library(&app)?.join("Inbox").join(&file_name);
    write_atomically(&path, &contents).map_err(|e| format!("Couldn't save {file_name}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            ensure_library(app.handle()).map_err(Box::<dyn std::error::Error>::from)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![library_path, save_document])
        .run(tauri::generate_context!())
        .expect("error while running Quill");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_generated_names() {
        assert!(valid_file_name("2026-11-20-160412.html"));
    }

    #[test]
    fn rejects_paths_and_other_files() {
        for bad in ["", ".html", "../x.html", "a\\b.html", "C:x.html", "notes.txt", ".hidden.html"] {
            assert!(!valid_file_name(bad), "{bad} should be rejected");
        }
    }

    #[test]
    fn atomic_write_replaces_contents() {
        let dir = std::env::temp_dir().join(format!("quill-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("doc.html");
        write_atomically(&p, "one").unwrap();
        write_atomically(&p, "two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert!(!dir.join("doc.html.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
