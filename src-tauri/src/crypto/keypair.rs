//! Ed25519 Key Pair Management
//!
//! Generiert, speichert und lädt Ed25519 Schlüsselpaare.
//! Der Private Key wird sicher im App-Datenverzeichnis gespeichert.
//!
//! ## Verwendung
//! ```rust
//! let keypair = KeyPair::load_or_create()?;
//! let signature = keypair.sign(b"Hello, World!")?;
//! let public_key_base64 = keypair.public_key_base64();
//! ```

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum KeyPairError {
    #[error("Failed to create app data directory: {0}")]
    DirectoryCreation(#[from] std::io::Error),

    #[error("Failed to decode private key: {0}")]
    Base64Decode(#[from] base64::DecodeError),

    #[error("Invalid private key length: expected 32, got {0}")]
    InvalidKeyLength(usize),

    #[error("Failed to create signing key from bytes")]
    InvalidKey,
}

// ============================================================================
// KEYPAIR STRUCT
// ============================================================================

/// Ed25519 Schlüsselpaar für Signierung und Authentifizierung
#[derive(Clone)]
pub struct KeyPair {
    signing_key: SigningKey,
}

impl KeyPair {
    /// Lädt ein existierendes Schlüsselpaar oder erstellt ein neues
    ///
    /// Der Key wird im App-Datenverzeichnis gespeichert:
    /// - Windows: `%APPDATA%/com.kaufm.call-app/keys/private.key`
    /// - macOS: `~/Library/Application Support/com.kaufm.call-app/keys/private.key`
    /// - Linux: `~/.config/com.kaufm.call-app/keys/private.key`
    pub fn load_or_create() -> Result<Self, KeyPairError> {
        let key_path = Self::get_key_path()?;

        if key_path.exists() {
            tracing::info!("Loading existing keypair from {:?}", key_path);
            Self::load_from_file(&key_path)
        } else {
            tracing::info!("Creating new keypair at {:?}", key_path);
            let keypair = Self::generate();
            keypair.save_to_file(&key_path)?;
            Ok(keypair)
        }
    }

    /// Generiert ein neues zufälliges Schlüsselpaar
    pub fn generate() -> Self {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        Self { signing_key }
    }

    /// Lädt ein Schlüsselpaar aus einer Datei
    fn load_from_file(path: &PathBuf) -> Result<Self, KeyPairError> {
        let encoded = fs::read_to_string(path)?;
        let bytes = BASE64.decode(encoded.trim())?;

        if bytes.len() != 32 {
            return Err(KeyPairError::InvalidKeyLength(bytes.len()));
        }

        let key_bytes: [u8; 32] = bytes.try_into().map_err(|_| KeyPairError::InvalidKey)?;

        let signing_key = SigningKey::from_bytes(&key_bytes);
        Ok(Self { signing_key })
    }

    /// Speichert den Private Key in einer Datei
    fn save_to_file(&self, path: &PathBuf) -> Result<(), KeyPairError> {
        // Parent-Verzeichnis erstellen falls nicht vorhanden
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let encoded = BASE64.encode(self.signing_key.to_bytes());
        fs::write(path, encoded)?;

        // Datei-Berechtigungen setzen (nur unter Unix)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(path)?.permissions();
            perms.set_mode(0o600); // Nur Owner kann lesen/schreiben
            fs::set_permissions(path, perms)?;
        }

        Ok(())
    }

    /// Ermittelt den Pfad zur Key-Datei
    fn get_key_path() -> Result<PathBuf, KeyPairError> {
        let proj_dirs =
            directories::ProjectDirs::from("com", "kaufm", "call-app").ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not determine app data directory",
                )
            })?;

        let mut path = proj_dirs.data_dir().to_path_buf();
        path.push("keys");
        path.push("private.key");
        Ok(path)
    }

    /// Signiert Daten mit dem Private Key
    ///
    /// Gibt die Signatur als 64 Bytes zurück.
    pub fn sign(&self, message: &[u8]) -> Signature {
        self.signing_key.sign(message)
    }

    /// Signiert Daten und gibt die Signatur als Base64 zurück
    pub fn sign_base64(&self, message: &[u8]) -> String {
        let signature = self.sign(message);
        BASE64.encode(signature.to_bytes())
    }

    /// Gibt den Public Key als raw bytes (32 Bytes) zurück
    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.verifying_key().to_bytes()
    }

    /// Gibt den Public Key als Base64-encoded String zurück
    pub fn public_key_base64(&self) -> String {
        BASE64.encode(self.public_key_bytes())
    }

    /// Gibt den VerifyingKey (Public Key) zurück
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// Erstellt eine signierte Nachricht für den Signaling-Server
    ///
    /// Die Signatur wird über den JSON-String aller Felder (außer signature)
    /// in alphabetischer Sortierung berechnet.
    pub fn sign_message(&self, payload: &serde_json::Value) -> String {
        // Felder sortieren (ohne signature)
        let sorted = Self::sort_json_object(payload);
        let payload_string = serde_json::to_string(&sorted).unwrap_or_default();
        self.sign_base64(payload_string.as_bytes())
    }

    /// Sortiert ein JSON-Objekt alphabetisch nach Keys
    fn sort_json_object(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let mut sorted_map = serde_json::Map::new();
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                for key in keys {
                    if key != "signature" {
                        if let Some(v) = map.get(key) {
                            sorted_map.insert(key.clone(), Self::sort_json_object(v));
                        }
                    }
                }
                serde_json::Value::Object(sorted_map)
            }
            other => other.clone(),
        }
    }
}

impl std::fmt::Debug for KeyPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyPair")
            .field("public_key", &self.public_key_base64())
            .finish()
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn test_keypair_generation() {
        let keypair = KeyPair::generate();
        let public_key = keypair.public_key_base64();

        // Public key sollte 44 Zeichen Base64 sein (32 bytes = 44 chars)
        assert_eq!(public_key.len(), 44);
    }

    #[test]
    fn test_sign_and_verify() {
        let keypair = KeyPair::generate();
        let message = b"Hello, World!";

        let signature = keypair.sign(message);

        // Verifizierung sollte erfolgreich sein
        let verifying_key = keypair.verifying_key();
        assert!(verifying_key.verify(message, &signature).is_ok());
    }

    #[test]
    fn test_sign_base64() {
        let keypair = KeyPair::generate();
        let message = b"Test message";

        let signature_base64 = keypair.sign_base64(message);

        // Signatur sollte 88 Zeichen Base64 sein (64 bytes = 88 chars)
        assert_eq!(signature_base64.len(), 88);
    }

    #[test]
    fn test_sign_json_message() {
        let keypair = KeyPair::generate();

        let payload = serde_json::json!({
            "type": "register",
            "username": "alice",
            "publicKey": keypair.public_key_base64(),
            "timestamp": 1234567890
        });

        let signature = keypair.sign_message(&payload);

        // Signatur sollte gültiges Base64 sein
        assert!(!signature.is_empty());
        assert!(BASE64.decode(&signature).is_ok());
    }
}
