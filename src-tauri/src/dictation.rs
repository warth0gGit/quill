//! Dictation: Quill listens to the microphone and writes what you say.
//!
//! Everything happens on this PC. The speech model (Whisper "base.en", about
//! 148 MB) is downloaded once into Quill's app data folder; after that,
//! dictation works offline and no sound ever leaves the computer.
//!
//! How it flows:
//! - A *listener* thread owns the microphone. It mixes the sound to mono,
//!   brings it down to the 16 kHz Whisper expects, reports how loud you are
//!   (for the living cursor), and cuts the sound into phrases at your pauses.
//! - A *writer* thread turns each phrase into text with Whisper and sends it
//!   to the window that asked, which puts it in at the cursor.
//!
//! The window hears about all of this through one event, `dictation://event`.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub const MODEL_FILE: &str = "ggml-base.en.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
/// Rough size, for the offer before the download starts.
pub const MODEL_MB: u32 = 148;

const RATE: usize = 16_000;
/// A pause this long ends a phrase.
const PAUSE: Duration = Duration::from_millis(900);
/// A phrase never runs longer than this before it is written out.
const LONGEST: usize = RATE * 14;
/// Sound kept from just before you start speaking, so first syllables aren't clipped.
const PRE_ROLL: usize = RATE * 3 / 10;
/// Less speech than this in a phrase is treated as a cough or a click.
const SHORTEST_SPEECH: usize = RATE / 4;
/// How often the window hears your voice level.
const LEVEL_EVERY: usize = RATE / 25;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    /// Loading the model into memory (only the first time per run).
    Preparing,
    Listening,
    /// 0..1, about 25 times a second while listening.
    Level { level: f32 },
    /// A phrase was heard and is being turned into words.
    Hearing,
    Text { text: String },
    /// Dictation ended. `error` says why, if it wasn't asked to stop.
    Stopped { error: Option<String> },
    /// The microphone gave nothing but silence for a while.
    Silent,
    /// The default microphone was silent, so another one is listening instead.
    OtherMic,
    Download { done: u64, total: u64 },
    Downloaded,
    DownloadFailed { error: String },
}

#[derive(Clone, Serialize)]
struct Envelope {
    window: String,
    #[serde(flatten)]
    event: Event,
}

fn send(app: &tauri::AppHandle, window: &str, event: Event) {
    let _ = app.emit("dictation://event", Envelope { window: window.to_string(), event });
}

#[derive(Default)]
pub struct Dictation {
    session: Mutex<Option<Session>>,
    downloading: AtomicBool,
    model: Mutex<Option<Arc<whisper_rs::WhisperContext>>>,
}

struct Session {
    window: String,
    stop: Arc<AtomicBool>,
}

pub fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Couldn't find Quill's data folder: {e}"))?;
    Ok(dir.join("models").join(MODEL_FILE))
}

pub fn has_model(app: &tauri::AppHandle) -> bool {
    model_path(app).map(|p| p.is_file()).unwrap_or(false)
}

/* ------------------------------------------------------------------ download */

pub fn download(app: tauri::AppHandle, window: String) {
    let state = app.state::<Dictation>();
    if state.downloading.swap(true, Ordering::SeqCst) {
        return; // already on its way
    }
    std::thread::spawn(move || {
        let result = fetch_model(&app, &window);
        app.state::<Dictation>().downloading.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => send(&app, &window, Event::Downloaded),
            Err(error) => send(&app, &window, Event::DownloadFailed { error }),
        }
    });
}

fn fetch_model(app: &tauri::AppHandle, window: &str) -> Result<(), String> {
    let path = model_path(app)?;
    let dir = path.parent().expect("models folder");
    fs::create_dir_all(dir).map_err(|e| format!("Couldn't make the models folder: {e}"))?;
    let part = path.with_extension("part");

    let offline = "Couldn't reach the download. Check the internet connection and try again.";
    let mut response = ureq::get(MODEL_URL).call().map_err(|_| offline.to_string())?;
    let total: u64 = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut reader = response.body_mut().with_config().limit(u64::MAX).reader();
    let mut file = fs::File::create(&part).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    let mut told = Instant::now() - Duration::from_secs(1);
    loop {
        let n = reader.read(&mut buf).map_err(|_| offline.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
        done += n as u64;
        if told.elapsed() > Duration::from_millis(250) {
            told = Instant::now();
            send(app, window, Event::Download { done, total });
        }
    }
    file.flush().map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    drop(file);
    if (total > 0 && done != total) || done < 1_000_000 {
        let _ = fs::remove_file(&part);
        return Err("The download was cut short. Try again.".into());
    }
    fs::rename(&part, &path).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    Ok(())
}

/* ------------------------------------------------------------------ start / stop */

pub fn start(app: tauri::AppHandle, window: String) -> Result<(), String> {
    let state = app.state::<Dictation>();
    let mut session = state.session.lock().unwrap();
    if let Some(s) = session.as_ref() {
        if s.window == window {
            return Ok(()); // already listening here
        }
        // Only one window listens at a time: the newest one wins.
        s.stop.store(true, Ordering::SeqCst);
    }
    if !has_model(&app) {
        return Err("model-missing".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    *session = Some(Session { window: window.clone(), stop: stop.clone() });
    drop(session);

    let (phrases_tx, phrases_rx) = mpsc::channel::<Vec<f32>>();
    let listen_error: Arc<Mutex<Option<String>>> = Arc::default();
    {
        let (app, window, stop, listen_error) = (app.clone(), window.clone(), stop.clone(), listen_error.clone());
        std::thread::spawn(move || {
            if let Err(e) = listen(&app, &window, &stop, &phrases_tx) {
                stop.store(true, Ordering::SeqCst);
                *listen_error.lock().unwrap() = Some(e);
            }
            // Dropping the sender lets the writer finish the last phrase and stop.
            drop(phrases_tx);
        });
    }
    std::thread::spawn(move || {
        let error = write(&app, &window, phrases_rx).err();
        stop.store(true, Ordering::SeqCst); // the writer failing ends listening too
        let error = listen_error.lock().unwrap().take().or(error);
        let state = app.state::<Dictation>();
        let mut session = state.session.lock().unwrap();
        if session.as_ref().is_some_and(|s| Arc::ptr_eq(&s.stop, &stop)) {
            *session = None;
        }
        drop(session);
        send(&app, &window, Event::Stopped { error });
    });
    Ok(())
}

pub fn stop(app: &tauri::AppHandle) {
    if let Some(s) = app.state::<Dictation>().session.lock().unwrap().as_ref() {
        s.stop.store(true, Ordering::SeqCst);
    }
}

/* ------------------------------------------------------------------ listening */

type Mic = (cpal::Stream, Receiver<Vec<f32>>, f64);

/// Opens one microphone: its sound arrives as mono chunks on the receiver.
fn open_mic(device: &cpal::Device) -> Result<Mic, String> {
    use cpal::traits::{DeviceTrait, StreamTrait};

    let config = device
        .default_input_config()
        .map_err(|_| "Quill can't find a microphone. Plug one in, or check Windows sound settings.".to_string())?;
    let channels = config.channels() as usize;
    let in_rate = config.sample_rate() as f64;
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let err = |_| {};
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config.into(),
            move |data: &[f32], _: &_| {
                let _ = tx.send(mix(data, channels, |s| s));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            config.into(),
            move |data: &[i16], _: &_| {
                let _ = tx.send(mix(data, channels, |s| s as f32 / 32768.0));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            config.into(),
            move |data: &[i32], _: &_| {
                let _ = tx.send(mix(data, channels, |s| s as f32 / 2147483648.0));
            },
            err,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            config.into(),
            move |data: &[u16], _: &_| {
                let _ = tx.send(mix(data, channels, |s| (s as f32 - 32768.0) / 32768.0));
            },
            err,
            None,
        ),
        _ => return Err("Quill doesn't understand this microphone's sound format.".into()),
    }
    .map_err(|_| "Quill couldn't open the microphone. Another app may be using it.".to_string())?;
    stream
        .play()
        .map_err(|_| "Quill couldn't start the microphone. Check Windows Settings > Privacy > Microphone.".to_string())?;
    Ok((stream, rx, in_rate))
}

/// The default microphone gave pure silence: tries each of the others for a
/// moment and returns the first that actually hears something.
fn find_live_mic(stop: &AtomicBool) -> Option<Mic> {
    use cpal::traits::HostTrait;
    let devices = cpal::default_host().input_devices().ok()?;
    for device in devices {
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        let Ok(mic) = open_mic(&device) else { continue };
        let until = Instant::now() + Duration::from_millis(1200);
        while Instant::now() < until {
            match mic.1.recv_timeout(Duration::from_millis(100)) {
                Ok(c) if c.iter().any(|s| *s != 0.0) => return Some(mic),
                Err(RecvTimeoutError::Disconnected) => break,
                _ => {}
            }
        }
    }
    None
}

fn listen(app: &tauri::AppHandle, window: &str, stop: &AtomicBool, phrases: &Sender<Vec<f32>>) -> Result<(), String> {
    use cpal::traits::HostTrait;

    let device = cpal::default_host()
        .default_input_device()
        .ok_or("Quill can't find a microphone. Plug one in, or check Windows sound settings.")?;
    let (mut stream, mut rx, mut in_rate) = open_mic(&device)?;
    send(app, window, Event::Listening);

    let mut resample = Resampler::new(in_rate, RATE as f64);
    let mut cutter = Phrases::default();
    let mut level_buf: Vec<f32> = Vec::with_capacity(LEVEL_EVERY);
    let started = Instant::now();
    let mut heard_anything = false;
    let mut warned_silent = false;

    while !stop.load(Ordering::SeqCst) {
        let chunk = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(c) => c,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return Err("The microphone stopped working.".into()),
        };
        if !heard_anything && chunk.iter().any(|s| *s != 0.0) {
            heard_anything = true;
        }
        if !heard_anything && !warned_silent && started.elapsed() > Duration::from_millis(2500) {
            warned_silent = true;
            // The chosen microphone may be one that isn't plugged in or is
            // switched off: look for one that hears something.
            if let Some(mic) = find_live_mic(stop) {
                drop(std::mem::replace(&mut stream, mic.0));
                rx = mic.1;
                in_rate = mic.2;
                resample = Resampler::new(in_rate, RATE as f64);
                heard_anything = true;
                send(app, window, Event::OtherMic);
            } else {
                // Windows hands out pure silence when microphone access is off.
                send(app, window, Event::Silent);
            }
            continue;
        }
        for s in resample.push(&chunk) {
            level_buf.push(s);
            if level_buf.len() >= LEVEL_EVERY {
                let r = rms(&level_buf);
                // Speech sits around 0.02-0.2 RMS; spread that over 0..1 on a log scale.
                let level = ((r.max(1e-4).log10() + 3.0) / 2.2).clamp(0.0, 1.0);
                send(app, window, Event::Level { level: if cutter.speaking { level } else { level * 0.5 } });
                level_buf.clear();
            }
            if let Some(p) = cutter.push(s) {
                send(app, window, Event::Hearing);
                let _ = phrases.send(p);
            }
        }
    }
    drop(stream);
    if let Some(p) = cutter.finish() {
        send(app, window, Event::Hearing);
        let _ = phrases.send(p);
    }
    Ok(())
}

fn mix<T: Copy>(data: &[T], channels: usize, to_f32: impl Fn(T) -> f32) -> Vec<f32> {
    let channels = channels.max(1);
    data.chunks(channels)
        .map(|frame| frame.iter().map(|s| to_f32(*s)).sum::<f32>() / frame.len() as f32)
        .collect()
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Brings sound down to 16 kHz: averages each output sample's share of the
/// input (a simple low-pass), carrying the leftovers between chunks.
struct Resampler {
    step: f64,
    pos: f64,
    acc: f32,
    n: u32,
}

impl Resampler {
    fn new(from: f64, to: f64) -> Self {
        Self { step: from / to, pos: 0.0, acc: 0.0, n: 0 }
    }

    fn push(&mut self, input: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 1);
        for &s in input {
            self.acc += s;
            self.n += 1;
            self.pos += 1.0;
            if self.pos >= self.step {
                self.pos -= self.step;
                out.push(self.acc / self.n as f32);
                self.acc = 0.0;
                self.n = 0;
            }
        }
        out
    }
}

/// Cuts a stream of 16 kHz sound into phrases at the pauses.
///
/// What counts as "speaking" adapts to the room: it is a margin above the
/// quietest the microphone has recently been.
struct Phrases {
    window: Vec<f32>,
    floor: f32,
    speaking: bool,
    phrase: Vec<f32>,
    pre: std::collections::VecDeque<f32>,
    speech: usize,
    quiet: usize,
}

impl Default for Phrases {
    fn default() -> Self {
        Self {
            window: Vec::with_capacity(320),
            floor: 0.003,
            speaking: false,
            phrase: Vec::new(),
            pre: std::collections::VecDeque::with_capacity(PRE_ROLL),
            speech: 0,
            quiet: 0,
        }
    }
}

impl Phrases {
    /// Feeds one sample. Returns a finished phrase when a pause ends it.
    fn push(&mut self, s: f32) -> Option<Vec<f32>> {
        if self.speaking {
            self.phrase.push(s);
        } else {
            if self.pre.len() == PRE_ROLL {
                self.pre.pop_front();
            }
            self.pre.push_back(s);
        }
        self.window.push(s);
        if self.window.len() < 320 {
            return None; // judge loudness every 20 ms
        }
        let r = rms(&self.window);
        let n = self.window.len();
        self.window.clear();

        // The floor falls fast to quiet moments and only creeps up between
        // phrases, so a long sentence never raises the bar on its own tail.
        if r < self.floor {
            self.floor = self.floor * 0.7 + r * 0.3;
        } else if !self.speaking {
            self.floor = self.floor * 0.995 + r * 0.005;
        }
        self.floor = self.floor.clamp(0.0003, 0.03);
        // Sensitive on purpose: a soft word dropped is worse than a breath kept.
        let loud = r > (self.floor * 2.2).max(0.0025);

        if !self.speaking {
            if loud {
                self.speaking = true;
                self.phrase = self.pre.drain(..).collect();
                self.speech = n;
                self.quiet = 0;
            }
            return None;
        }
        if loud {
            self.speech += n;
            self.quiet = 0;
        } else {
            self.quiet += n;
        }
        let paused = self.quiet as f64 >= PAUSE.as_secs_f64() * RATE as f64;
        if paused || self.phrase.len() >= LONGEST {
            return self.finish();
        }
        None
    }

    /// Ends the phrase in progress, if it held enough speech to be worth writing.
    fn finish(&mut self) -> Option<Vec<f32>> {
        let was = std::mem::take(&mut self.phrase);
        let speech = std::mem::take(&mut self.speech);
        self.speaking = false;
        self.quiet = 0;
        (speech >= SHORTEST_SPEECH).then_some(was)
    }
}

/* ------------------------------------------------------------------ writing */

fn load_model(app: &tauri::AppHandle, window: &str) -> Result<Arc<whisper_rs::WhisperContext>, String> {
    let state = app.state::<Dictation>();
    let mut slot = state.model.lock().unwrap();
    if let Some(m) = slot.as_ref() {
        return Ok(m.clone());
    }
    send(app, window, Event::Preparing);
    let path = model_path(app)?;
    let ctx = whisper_rs::WhisperContext::new_with_params(
        &path,
        whisper_rs::WhisperContextParameters::default(),
    )
    .map_err(|_| {
        // A damaged file: remove it so the next try downloads a fresh one.
        let _ = fs::remove_file(&path);
        "The speech model was damaged. Press dictate again to download it afresh.".to_string()
    })?;
    let ctx = Arc::new(ctx);
    *slot = Some(ctx.clone());
    Ok(ctx)
}

fn write(app: &tauri::AppHandle, window: &str, phrases: Receiver<Vec<f32>>) -> Result<(), String> {
    let ctx = load_model(app, window)?;
    let mut state = ctx.create_state().map_err(|_| "Quill couldn't start the speech model.".to_string())?;
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8) as i32;

    // Ends when the listener is done and every phrase has been written.
    for mut audio in phrases {
        // Whisper wants at least a second of sound; pad short phrases with quiet.
        if audio.len() < RATE + RATE / 10 {
            audio.resize(RATE + RATE / 10, 0.0);
        }
        let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_n_threads(threads);
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_single_segment(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if state.full(params, &audio).is_err() {
            continue;
        }
        let mut text = String::new();
        for segment in state.as_iter() {
            if let Ok(t) = segment.to_str_lossy() {
                text.push_str(&t);
            }
        }
        let text = clean(&text);
        if text.is_empty() {
            continue;
        }
        send(app, window, Event::Text { text });
    }
    Ok(())
}

/// Drops Whisper's sound labels like "[BLANK_AUDIO]" or "(wind blowing)",
/// and the stock phrases it invents for silence.
pub fn clean(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let (mut depth, mut star) = (0i32, false);
    for c in raw.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' => depth = (depth - 1).max(0),
            '*' => star = !star,
            _ if depth == 0 && !star => out.push(c),
            _ => {}
        }
    }
    let text = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let bare = text.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
    const INVENTED: [&str; 5] = ["thank you", "thanks for watching", "thank you for watching", "you", "bye"];
    if bare.is_empty() || INVENTED.contains(&bare.as_str()) {
        return String::new();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_drops_labels_and_silence_phrases() {
        assert_eq!(clean(" [BLANK_AUDIO]"), "");
        assert_eq!(clean(" (wind blowing) Hello there."), "Hello there.");
        assert_eq!(clean("*sighs* Right."), "Right.");
        assert_eq!(clean(" Thank you."), "");
        assert_eq!(clean(" Thank you for the tea."), "Thank you for the tea.");
    }

    #[test]
    fn resampler_keeps_time() {
        let mut r = Resampler::new(48_000.0, 16_000.0);
        let out = r.push(&vec![0.5; 48_000]);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|s| (*s - 0.5).abs() < 1e-6));
        let mut r = Resampler::new(44_100.0, 16_000.0);
        let n: usize = (0..10).map(|_| r.push(&vec![0.0; 4_410]).len()).sum();
        assert!((15_999..=16_001).contains(&n));
    }

    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize).map(|i| amp * (i as f32 * 0.2).sin()).collect()
    }

    #[test]
    fn phrases_split_at_pauses() {
        let mut p = Phrases::default();
        let mut sound = tone(0.5, 0.0005);
        sound.extend(tone(1.2, 0.2));
        sound.extend(tone(1.2, 0.0005));
        sound.extend(tone(0.8, 0.2));
        sound.extend(tone(0.3, 0.0005));
        let mut got = Vec::new();
        for s in sound {
            if let Some(ph) = p.push(s) {
                got.push(ph.len());
            }
        }
        assert_eq!(got.len(), 1, "the first phrase ends at the long pause");
        let first = got[0] as f32 / RATE as f32;
        assert!(first > 1.6 && first < 2.6, "first phrase was {first}s");
        let last = p.finish().expect("the second phrase is still open");
        assert!(last.len() as f32 / RATE as f32 > 0.8);
    }

    #[test]
    fn a_softer_end_of_sentence_is_kept() {
        let mut p = Phrases::default();
        let mut sound = tone(0.5, 0.001);
        sound.extend(tone(1.0, 0.15)); // a strong start
        sound.extend(tone(2.0, 0.012)); // trailing off, much quieter
        sound.extend(tone(1.2, 0.001));
        let mut got = Vec::new();
        for s in sound {
            if let Some(ph) = p.push(s) {
                got.push(ph.len());
            }
        }
        assert_eq!(got.len(), 1);
        let secs = got[0] as f32 / RATE as f32;
        assert!(secs > 3.0, "the quiet tail was cut off: {secs}s");
    }

    #[test]
    fn a_click_is_not_a_phrase() {
        let mut p = Phrases::default();
        let mut sound = tone(0.5, 0.0005);
        sound.extend(tone(0.06, 0.3));
        sound.extend(tone(1.0, 0.0005));
        assert!(sound.into_iter().all(|s| p.push(s).is_none()));
        assert!(p.finish().is_none());
    }
}
