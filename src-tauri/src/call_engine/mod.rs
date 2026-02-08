//! Call Engine Module - WebRTC und Audio
//!
//! Dieses Modul verwaltet:
//! - WebRTC Peer Connections
//! - Audio Capture (Mikrofon)
//! - Audio Playback (Lautsprecher)
//! - Opus Encoding/Decoding

mod audio;
mod engine;

pub use audio::{AudioError, AudioHandler, FRAME_SIZE, SAMPLE_RATE};
pub use engine::{CallEngine, CallEngineError, CallEvent, CallState};
