//! Signaling Module - WebSocket Client für Cloudflare Worker
//!
//! Dieses Modul verwaltet die Kommunikation mit dem Signaling-Server:
//! - WebSocket-Verbindung aufbauen und halten
//! - Nachrichten signieren und senden
//! - Eingehende Nachrichten parsen und weiterleiten
//!

mod client;
mod messages;

pub use client::{SignalingClient, SignalingError, SignalingEvent};
pub use messages::*;
