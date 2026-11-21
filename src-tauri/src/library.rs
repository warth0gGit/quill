//! The library on disk: folders and documents under `Documents\Quill`.
//!
//! Everything here takes the library root explicitly, so it can be tested
//! against a temporary folder. Paths that cross the boundary to the front end
//! are relative to the root and use `/`, for example `Essays/Drafts/2026-11-20-160412.html`.
//! The empty string is the root itself. Every path is checked segment by
//! segment before it touches the disk, so nothing outside the library can be
//! named.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const INBOX: &str = "Inbox";
const TRASH: &str = ".trash";
const ORIGIN_FILE: &str = "origin.txt";
const TRASH_DAYS: u64 = 30;
const MAX_DEPTH: usize = 32;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Entry {
    Folder { name: String, path: String, children: Vec<Entry> },
    Doc { name: String, path: String, title: String, modified: u64 },
}

pub type Result<T> = std::result::Result<T, String>;

/* ------------------------------------------------------------------ names */

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
    "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A folder name Windows will accept and that can't escape the library.
pub fn valid_folder_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !name.is_empty()
        && name.chars().count() <= 120
        && name.trim() == name
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !RESERVED.contains(&stem.as_str())
}

/// A document file name: a valid name that ends in `.html`.
pub fn valid_doc_name(name: &str) -> bool {
    name.len() > ".html".len() && name.ends_with(".html") && valid_folder_name(name)
}

/// Turn a relative library path into a real path, refusing anything odd.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let mut p = root.to_path_buf();
    if rel.is_empty() {
        return Ok(p);
    }
    for seg in rel.split('/') {
        if !valid_folder_name(seg) {
            return Err(format!("That isn't a valid place in the library: {rel}"));
        }
        p.push(seg);
    }
    Ok(p)
}

fn parent_rel(rel: &str) -> &str {
    rel.rfind('/').map_or("", |i| &rel[..i])
}

fn last_seg(rel: &str) -> &str {
    rel.rfind('/').map_or(rel, |i| &rel[i + 1..])
}

fn join_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// "Drafts" -> "Drafts 2", "x.html" -> "x 2.html", until the name is free.
fn free_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = match name.strip_suffix(".html") {
        Some(s) => (s, ".html"),
        None => (name, ""),
    };
    (2..)
        .map(|n| format!("{stem} {n}{ext}"))
        .find(|candidate| !dir.join(candidate).exists())
        .expect("some name is free")
}

fn is_protected(rel: &str) -> bool {
    rel.is_empty() || rel == INBOX
}

/* ------------------------------------------------------------------ listing */

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

/// The document's title, from the `<title>` Quill writes near the top of the file.
pub fn read_title(path: &Path) -> String {
    let mut head = vec![0u8; 4096];
    let n = fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    let head = String::from_utf8_lossy(&head[..n]);
    head.find("<title>")
        .and_then(|a| {
            let rest = &head[a + 7..];
            rest.find("</title>").map(|b| unescape(rest[..b].trim()))
        })
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn list_dir(root: &Path, rel: &str, depth: usize) -> Vec<Entry> {
    let Ok(dir) = resolve(root, rel) else { return vec![] };
    let Ok(read) = fs::read_dir(&dir) else { return vec![] };
    let mut folders = vec![];
    let mut docs = vec![];
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let Ok(ft) = item.file_type() else { continue };
        if ft.is_dir() && valid_folder_name(&name) && depth < MAX_DEPTH {
            let path = join_rel(rel, &name);
            let children = list_dir(root, &path, depth + 1);
            folders.push(Entry::Folder { name, path, children });
        } else if ft.is_file() && valid_doc_name(&name) {
            let modified = item.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
            let title = read_title(&item.path());
            docs.push(Entry::Doc { path: join_rel(rel, &name), name, title, modified });
        }
    }
    // Inbox first, then folders A to Z; documents newest first.
    folders.sort_by_key(|f| match f {
        Entry::Folder { name, .. } => (!(rel.is_empty() && name == INBOX), name.to_lowercase()),
        _ => unreachable!(),
    });
    docs.sort_by_key(|d| match d {
        Entry::Doc { modified, .. } => std::cmp::Reverse(*modified),
        _ => unreachable!(),
    });
    folders.extend(docs);
    folders
}

pub fn list(root: &Path) -> Entry {
    Entry::Folder { name: "Library".into(), path: String::new(), children: list_dir(root, "", 0) }
}

/* ------------------------------------------------------------------ documents */

/// Write to a temporary file first, then move it into place, so a crash or
/// power cut never leaves a half-written document.
pub fn write_atomically(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("html.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub fn save(root: &Path, rel: &str, contents: &str) -> Result<PathBuf> {
    if !valid_doc_name(last_seg(rel)) {
        return Err(format!("Refused to save an unexpected file name: {rel}"));
    }
    let path = resolve(root, rel)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Couldn't create the folder for {rel}: {e}"))?;
    }
    write_atomically(&path, contents).map_err(|e| format!("Couldn't save {rel}: {e}"))?;
    Ok(path)
}

pub fn read(root: &Path, rel: &str) -> Result<String> {
    if !valid_doc_name(last_seg(rel)) {
        return Err(format!("That isn't a Quill document: {rel}"));
    }
    fs::read_to_string(resolve(root, rel)?).map_err(|e| format!("Couldn't open {rel}: {e}"))
}

/* ------------------------------------------------------------------ folders */

pub fn create_folder(root: &Path, parent: &str, name: &str) -> Result<String> {
    let name = name.trim();
    if !valid_folder_name(name) {
        return Err(format!("“{name}” can't be used as a folder name"));
    }
    let dir = resolve(root, parent)?;
    if !dir.is_dir() {
        return Err("That folder no longer exists".into());
    }
    if dir.join(name).exists() {
        return Err(format!("There's already a folder called “{name}” there"));
    }
    fs::create_dir(dir.join(name)).map_err(|e| format!("Couldn't create “{name}”: {e}"))?;
    Ok(join_rel(parent, name))
}

pub fn rename_folder(root: &Path, rel: &str, name: &str) -> Result<String> {
    let name = name.trim();
    if is_protected(rel) {
        return Err("The Inbox can't be renamed".into());
    }
    if !valid_folder_name(name) {
        return Err(format!("“{name}” can't be used as a folder name"));
    }
    let from = resolve(root, rel)?;
    if !from.is_dir() {
        return Err("That folder no longer exists".into());
    }
    let parent = parent_rel(rel);
    let to = resolve(root, parent)?.join(name);
    // Changing only the letter case is allowed even though Windows sees the
    // new name as already taken (it's the same folder).
    if to.exists() && !last_seg(rel).eq_ignore_ascii_case(name) {
        return Err(format!("There's already a folder called “{name}” there"));
    }
    fs::rename(&from, &to).map_err(|e| format!("Couldn't rename the folder: {e}"))?;
    Ok(join_rel(parent, name))
}

/// Move a folder or document into another folder. Returns its new path.
pub fn move_item(root: &Path, rel: &str, into: &str) -> Result<String> {
    if is_protected(rel) {
        return Err("The Inbox stays where it is".into());
    }
    if into == rel || into.starts_with(&format!("{rel}/")) {
        return Err("A folder can't go inside itself".into());
    }
    if parent_rel(rel) == into {
        return Ok(rel.to_string());
    }
    let from = resolve(root, rel)?;
    let dest = resolve(root, into)?;
    if !from.exists() {
        return Err("That item no longer exists".into());
    }
    if !dest.is_dir() {
        return Err("That folder no longer exists".into());
    }
    let name = free_name(&dest, last_seg(rel));
    fs::rename(&from, dest.join(&name)).map_err(|e| format!("Couldn't move it: {e}"))?;
    Ok(join_rel(into, &name))
}

/* ------------------------------------------------------------------ trash */

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Move a folder or document to the hidden Trash. Returns an id for Undo.
pub fn trash(root: &Path, rel: &str) -> Result<String> {
    if is_protected(rel) {
        return Err("The Inbox can't be moved to the Trash".into());
    }
    let from = resolve(root, rel)?;
    if !from.exists() {
        return Err("That item no longer exists".into());
    }
    let bin = root.join(TRASH);
    let mut stamp = now_ms();
    while bin.join(stamp.to_string()).exists() {
        stamp += 1;
    }
    let id = stamp.to_string();
    let slot = bin.join(&id);
    fs::create_dir_all(&slot).map_err(|e| format!("Couldn't open the Trash: {e}"))?;
    fs::write(slot.join(ORIGIN_FILE), rel).map_err(|e| format!("Couldn't write to the Trash: {e}"))?;
    if let Err(e) = fs::rename(&from, slot.join(last_seg(rel))) {
        let _ = fs::remove_dir_all(&slot);
        return Err(format!("Couldn't move it to the Trash: {e}"));
    }
    Ok(id)
}

/// Put a trashed item back where it was. Returns its path (renamed if that
/// name has been taken since).
pub fn restore(root: &Path, id: &str) -> Result<String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Nothing to undo".into());
    }
    let slot = root.join(TRASH).join(id);
    let origin = fs::read_to_string(slot.join(ORIGIN_FILE)).map_err(|_| "That's no longer in the Trash".to_string())?;
    let origin = origin.trim();
    resolve(root, origin)?; // the recorded path must still be a valid one
    let parent = parent_rel(origin);
    let dir = resolve(root, parent)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't recreate {parent}: {e}"))?;
    let name = free_name(&dir, last_seg(origin));
    fs::rename(slot.join(last_seg(origin)), dir.join(&name)).map_err(|e| format!("Couldn't restore it: {e}"))?;
    let _ = fs::remove_dir_all(&slot);
    Ok(join_rel(parent, &name))
}

/// Remove Trash entries older than 30 days.
pub fn empty_old_trash(root: &Path) {
    let cutoff = now_ms().saturating_sub(Duration::from_secs(TRASH_DAYS * 86_400).as_millis() as u64);
    let Ok(read) = fs::read_dir(root.join(TRASH)) else { return };
    for item in read.flatten() {
        let old = item.file_name().to_str().and_then(|n| n.parse::<u64>().ok()).is_some_and(|t| t < cutoff);
        if old {
            let _ = fs::remove_dir_all(item.path());
        }
    }
}

/// Hide the Trash folder in File Explorer, as Windows does for its own.
#[cfg(windows)]
pub fn hide_trash(root: &Path) {
    use std::os::windows::process::CommandExt;
    let bin = root.join(TRASH);
    if fs::create_dir_all(&bin).is_ok() {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("attrib").arg("+h").arg(&bin).creation_flags(CREATE_NO_WINDOW).status();
    }
}
#[cfg(not(windows))]
pub fn hide_trash(_root: &Path) {}

/* ------------------------------------------------------------------ tests */

#[cfg(test)]
mod tests {
    use super::*;

    struct TempLib(PathBuf);
    impl TempLib {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("quill-lib-{tag}-{}-{}", std::process::id(), now_ms()));
            fs::create_dir_all(p.join(INBOX)).unwrap();
            TempLib(p)
        }
    }
    impl Drop for TempLib {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn doc(title: &str) -> String {
        format!("<!doctype html><html><head><title>{title}</title></head><body></body></html>")
    }

    #[test]
    fn names() {
        for ok in ["Essays", "2026", "Q3 review", "Café notes", "a.b"] {
            assert!(valid_folder_name(ok), "{ok}");
        }
        for bad in ["", ".trash", "..", "a/b", "a\\b", "C:", "x?", " pad", "pad ", "dot.", "CON", "nul.txt", "COM1"] {
            assert!(!valid_folder_name(bad), "{bad}");
        }
        assert!(valid_doc_name("2026-11-20-160412.html"));
        assert!(!valid_doc_name(".html"));
        assert!(!valid_doc_name("notes.txt"));
    }

    #[test]
    fn resolve_refuses_escapes() {
        let root = Path::new("/lib");
        assert_eq!(resolve(root, "").unwrap(), PathBuf::from("/lib"));
        assert_eq!(resolve(root, "Essays/Drafts").unwrap(), PathBuf::from("/lib/Essays/Drafts"));
        for bad in ["../x", "a//b", "/abs", "a/../b", ".trash/1", "C:/x"] {
            assert!(resolve(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn atomic_write_replaces_contents() {
        let lib = TempLib::new("atomic");
        let p = lib.0.join("doc.html");
        write_atomically(&p, "one").unwrap();
        write_atomically(&p, "two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert!(!lib.0.join("doc.html.tmp").exists());
    }

    #[test]
    fn list_shows_folders_then_docs_with_titles() {
        let lib = TempLib::new("list");
        let r = &lib.0;
        create_folder(r, "", "Essays").unwrap();
        create_folder(r, "", "drafts").unwrap();
        save(r, "Inbox/2026-01-01-000000.html", &doc("Hello &amp; welcome")).unwrap();
        save(r, "Essays/2026-01-02-000000.html", &doc("On slowness")).unwrap();
        fs::write(r.join("stray.txt"), "ignored").unwrap();
        trash(r, "Essays/2026-01-02-000000.html").unwrap();
        let Entry::Folder { children, .. } = list(r) else { panic!() };
        let names: Vec<_> = children
            .iter()
            .map(|e| match e {
                Entry::Folder { name, .. } => name.clone(),
                Entry::Doc { title, .. } => title.clone(),
            })
            .collect();
        assert_eq!(names, ["Inbox", "drafts", "Essays"]); // Inbox first, then A to Z; Trash hidden
        let Entry::Folder { children: inbox, .. } = &children[0] else { panic!() };
        assert_eq!(
            inbox[0],
            Entry::Doc {
                name: "2026-01-01-000000.html".into(),
                path: "Inbox/2026-01-01-000000.html".into(),
                title: "Hello & welcome".into(),
                modified: match &inbox[0] {
                    Entry::Doc { modified, .. } => *modified,
                    _ => 0,
                },
            }
        );
    }

    #[test]
    fn folders_create_rename_and_refuse_clashes() {
        let lib = TempLib::new("folders");
        let r = &lib.0;
        assert_eq!(create_folder(r, "", " Essays ").unwrap(), "Essays");
        assert!(create_folder(r, "", "Essays").is_err());
        assert!(create_folder(r, "", "bad/name").is_err());
        assert_eq!(create_folder(r, "Essays", "Drafts").unwrap(), "Essays/Drafts");
        assert_eq!(rename_folder(r, "Essays/Drafts", "Ideas").unwrap(), "Essays/Ideas");
        assert_eq!(rename_folder(r, "Essays/Ideas", "ideas").unwrap(), "Essays/ideas"); // case only
        assert!(rename_folder(r, "Inbox", "Other").is_err());
        assert!(r.join("Essays/ideas").is_dir());
    }

    #[test]
    fn moving_files_and_folders() {
        let lib = TempLib::new("move");
        let r = &lib.0;
        create_folder(r, "", "Essays").unwrap();
        create_folder(r, "Essays", "Drafts").unwrap();
        save(r, "Inbox/a.html", &doc("A")).unwrap();
        assert_eq!(move_item(r, "Inbox/a.html", "Essays/Drafts").unwrap(), "Essays/Drafts/a.html");
        assert!(move_item(r, "Essays", "Essays/Drafts").is_err(), "into itself");
        assert!(move_item(r, "Inbox", "Essays").is_err(), "Inbox stays");
        create_folder(r, "", "Drafts").unwrap();
        // A name clash on move keeps both, numbering the newcomer.
        assert_eq!(move_item(r, "Essays/Drafts", "").unwrap(), "Drafts 2");
        assert_eq!(read(r, "Drafts 2/a.html").unwrap(), doc("A"));
        assert_eq!(move_item(r, "Drafts 2", "").unwrap(), "Drafts 2", "already there");
    }

    #[test]
    fn trash_and_restore() {
        let lib = TempLib::new("trash");
        let r = &lib.0;
        create_folder(r, "", "Essays").unwrap();
        save(r, "Essays/a.html", &doc("A")).unwrap();
        let id = trash(r, "Essays").unwrap();
        assert!(!r.join("Essays").exists());
        assert!(trash(r, "Inbox").is_err());
        // Someone made a new Essays folder meanwhile: the restored one is renamed.
        create_folder(r, "", "Essays").unwrap();
        assert_eq!(restore(r, &id).unwrap(), "Essays 2");
        assert_eq!(read(r, "Essays 2/a.html").unwrap(), doc("A"));
        assert!(restore(r, &id).is_err(), "only once");
        assert!(restore(r, "../x").is_err());
        // A document whose folder was removed comes back with its folder.
        let id = trash(r, "Essays 2/a.html").unwrap();
        fs::remove_dir_all(r.join("Essays 2")).unwrap();
        assert_eq!(restore(r, &id).unwrap(), "Essays 2/a.html");
    }

    #[test]
    fn old_trash_is_emptied() {
        let lib = TempLib::new("empty");
        let r = &lib.0;
        save(r, "Inbox/a.html", &doc("A")).unwrap();
        let fresh = trash(r, "Inbox/a.html").unwrap();
        let old = r.join(TRASH).join("1000");
        fs::create_dir_all(&old).unwrap();
        empty_old_trash(r);
        assert!(!old.exists());
        assert!(r.join(TRASH).join(fresh).exists());
    }
}
