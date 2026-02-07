//! Crypto Module - Ed25519 Key Management
//!
//! Dieses Modul verwaltet die kryptographische Identität des Benutzers:
//! - Generierung eines Ed25519 Schlüsselpaars beim ersten Start
//! - Persistente Speicherung des Private Keys
//! - Signierung von Nachrichten für den Signaling-Server
//!

mod keypair;

pub use keypair::{KeyPair, KeyPairError};
