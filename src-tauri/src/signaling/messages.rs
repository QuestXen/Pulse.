//! Message Types für Signaling-Protokoll
//!
//! Diese Strukturen spiegeln die TypeScript-Definitionen aus dem
//! Cloudflare Worker wider und ermöglichen typsichere Kommunikation.

use serde::{Deserialize, Serialize};

// ============================================================================
// CLIENT → SERVER MESSAGES
// ============================================================================

/// Basis für alle Client-Nachrichten
#[derive(Debug, Clone, Serialize)]
pub struct SignedMessage<T: Serialize> {
    #[serde(flatten)]
    pub payload: T,
    pub timestamp: i64,
    pub signature: String,
}

/// Registrierung eines neuen Benutzers
#[derive(Debug, Clone, Serialize)]
pub struct RegisterPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    pub username: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
}

impl RegisterPayload {
    pub fn new(username: String, public_key: String) -> Self {
        Self {
            msg_type: "register",
            username,
            public_key,
        }
    }
}

/// Benutzer suchen
#[derive(Debug, Clone, Serialize)]
pub struct FindUserPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "peerId")]
    pub peer_id: String,
    #[serde(rename = "targetUsername")]
    pub target_username: String,
}

impl FindUserPayload {
    pub fn new(peer_id: String, target_username: String) -> Self {
        Self {
            msg_type: "find_user",
            peer_id,
            target_username,
        }
    }
}

/// SDP Offer senden
#[derive(Debug, Clone, Serialize)]
pub struct OfferPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "fromPeerId")]
    pub from_peer_id: String,
    #[serde(rename = "toPeerId")]
    pub to_peer_id: String,
    pub sdp: String,
}

impl OfferPayload {
    pub fn new(from_peer_id: String, to_peer_id: String, sdp: String) -> Self {
        Self {
            msg_type: "offer",
            from_peer_id,
            to_peer_id,
            sdp,
        }
    }
}

/// SDP Answer senden
#[derive(Debug, Clone, Serialize)]
pub struct AnswerPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "fromPeerId")]
    pub from_peer_id: String,
    #[serde(rename = "toPeerId")]
    pub to_peer_id: String,
    pub sdp: String,
}

impl AnswerPayload {
    pub fn new(from_peer_id: String, to_peer_id: String, sdp: String) -> Self {
        Self {
            msg_type: "answer",
            from_peer_id,
            to_peer_id,
            sdp,
        }
    }
}

/// ICE Candidate senden
#[derive(Debug, Clone, Serialize)]
pub struct IceCandidatePayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "fromPeerId")]
    pub from_peer_id: String,
    #[serde(rename = "toPeerId")]
    pub to_peer_id: String,
    pub candidate: String,
}

impl IceCandidatePayload {
    pub fn new(from_peer_id: String, to_peer_id: String, candidate: String) -> Self {
        Self {
            msg_type: "ice_candidate",
            from_peer_id,
            to_peer_id,
            candidate,
        }
    }
}

/// Anruf ablehnen
#[derive(Debug, Clone, Serialize)]
pub struct RejectCallPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "fromPeerId")]
    pub from_peer_id: String,
    #[serde(rename = "toPeerId")]
    pub to_peer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl RejectCallPayload {
    pub fn new(from_peer_id: String, to_peer_id: String, reason: Option<String>) -> Self {
        Self {
            msg_type: "reject_call",
            from_peer_id,
            to_peer_id,
            reason,
        }
    }
}

/// Anruf beenden
#[derive(Debug, Clone, Serialize)]
pub struct HangupPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "fromPeerId")]
    pub from_peer_id: String,
    #[serde(rename = "toPeerId")]
    pub to_peer_id: String,
}

impl HangupPayload {
    pub fn new(from_peer_id: String, to_peer_id: String) -> Self {
        Self {
            msg_type: "hangup",
            from_peer_id,
            to_peer_id,
        }
    }
}

/// Heartbeat
#[derive(Debug, Clone, Serialize)]
pub struct HeartbeatPayload {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    #[serde(rename = "peerId")]
    pub peer_id: String,
}

impl HeartbeatPayload {
    pub fn new(peer_id: String) -> Self {
        Self {
            msg_type: "heartbeat",
            peer_id,
        }
    }
}

// ============================================================================
// SERVER → CLIENT MESSAGES
// ============================================================================

/// Alle möglichen Server-Nachrichten
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Erfolgreiche Registrierung
    Registered {
        #[serde(rename = "peerId")]
        peer_id: String,
        username: String,
        timestamp: i64,
    },

    /// Benutzer gefunden
    UserFound {
        #[serde(rename = "peerId")]
        peer_id: String,
        username: String,
        #[serde(rename = "isOnline")]
        is_online: bool,
        timestamp: i64,
    },

    /// Benutzer nicht gefunden
    UserNotFound { username: String, timestamp: i64 },

    /// Eingehendes SDP Offer
    IncomingOffer {
        #[serde(rename = "fromPeerId")]
        from_peer_id: String,
        #[serde(rename = "fromUsername")]
        from_username: String,
        sdp: String,
        timestamp: i64,
    },

    /// Eingehendes SDP Answer
    IncomingAnswer {
        #[serde(rename = "fromPeerId")]
        from_peer_id: String,
        sdp: String,
        timestamp: i64,
    },

    /// Eingehender ICE Candidate
    IncomingIceCandidate {
        #[serde(rename = "fromPeerId")]
        from_peer_id: String,
        candidate: String,
        timestamp: i64,
    },

    /// Anruf wurde abgelehnt
    CallRejected {
        #[serde(rename = "byPeerId")]
        by_peer_id: String,
        reason: Option<String>,
        timestamp: i64,
    },

    /// Anruf wurde beendet
    CallEnded {
        #[serde(rename = "byPeerId")]
        by_peer_id: String,
        timestamp: i64,
    },

    /// Benutzer ist offline gegangen
    UserOffline {
        #[serde(rename = "peerId")]
        peer_id: String,
        timestamp: i64,
    },

    /// Benutzer ist online gekommen
    UserOnline {
        #[serde(rename = "peerId")]
        peer_id: String,
        timestamp: i64,
    },

    /// Fehler
    Error {
        code: i32,
        message: String,
        timestamp: i64,
    },

    /// Heartbeat Antwort
    Pong { timestamp: i64 },
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/// Kontakt-Informationen
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactInfo {
    pub peer_id: String,
    pub username: String,
    pub is_online: bool,
}
