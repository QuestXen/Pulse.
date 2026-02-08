//! WebSocket Client für Signaling-Server
//!
//! Verwaltet die WebSocket-Verbindung zum Cloudflare Worker:
//! - Automatische Reconnection
//! - Heartbeat-Keeping
//! - Message Signing
//! - Event-basierte Kommunikation

use super::messages::*;
use crate::crypto::KeyPair;
use chrono::Utc;
use futures::{SinkExt, StreamExt};
use parking_lot::RwLock;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug, Clone)]
pub enum SignalingError {
    #[error("WebSocket connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Not connected to signaling server")]
    NotConnected,

    #[error("Failed to send message: {0}")]
    SendFailed(String),

    #[error("Registration failed: {0}")]
    RegistrationFailed(String),

    #[error("Server error: {code} - {message}")]
    ServerError { code: i32, message: String },
}

// ============================================================================
// SIGNALING EVENTS
// ============================================================================

/// Events die vom SignalingClient ausgelöst werden
#[derive(Debug, Clone)]
pub enum SignalingEvent {
    /// Verbunden mit Signaling-Server
    Connected,

    /// Verbindung getrennt
    Disconnected,

    /// Registrierung erfolgreich
    Registered { peer_id: String, username: String },

    /// Benutzer gefunden
    UserFound(ContactInfo),

    /// Benutzer nicht gefunden
    UserNotFound { username: String },

    /// Eingehender Anruf
    IncomingCall {
        from_peer_id: String,
        from_username: String,
        sdp: String,
    },

    /// SDP Answer erhalten
    AnswerReceived { from_peer_id: String, sdp: String },

    /// ICE Candidate erhalten
    IceCandidateReceived {
        from_peer_id: String,
        candidate: String,
    },

    /// Anruf abgelehnt
    CallRejected {
        by_peer_id: String,
        reason: Option<String>,
    },

    /// Anruf beendet
    CallEnded { by_peer_id: String },

    /// Kontakt online
    ContactOnline { peer_id: String },

    /// Kontakt offline
    ContactOffline { peer_id: String },

    /// Fehler vom Server
    Error { code: i32, message: String },
}

// ============================================================================
// CLIENT STATE
// ============================================================================

#[derive(Debug, Clone, Default)]
struct ClientState {
    is_connected: bool,
    peer_id: Option<String>,
    username: Option<String>,
}

// ============================================================================
// SIGNALING CLIENT
// ============================================================================

/// WebSocket Client für Signaling-Server Kommunikation
pub struct SignalingClient {
    server_url: String,
    keypair: Arc<KeyPair>,
    state: Arc<RwLock<ClientState>>,
    tx: Option<mpsc::Sender<String>>,
    event_tx: broadcast::Sender<SignalingEvent>,
}

impl SignalingClient {
    /// Erstellt einen neuen SignalingClient
    pub fn new(server_url: String, keypair: Arc<KeyPair>) -> Self {
        let (event_tx, _) = broadcast::channel(100);

        Self {
            server_url,
            keypair,
            state: Arc::new(RwLock::new(ClientState::default())),
            tx: None,
            event_tx,
        }
    }

    /// Gibt einen Event-Receiver zurück
    pub fn subscribe(&self) -> broadcast::Receiver<SignalingEvent> {
        self.event_tx.subscribe()
    }

    /// Gibt die aktuelle Peer-ID zurück (falls registriert)
    pub fn peer_id(&self) -> Option<String> {
        self.state.read().peer_id.clone()
    }

    /// Gibt den aktuellen Username zurück (falls registriert)
    pub fn username(&self) -> Option<String> {
        self.state.read().username.clone()
    }

    /// Prüft ob verbunden
    pub fn is_connected(&self) -> bool {
        self.state.read().is_connected
    }

    /// Verbindet mit dem Signaling-Server und registriert den Benutzer
    pub async fn connect_and_register(
        &mut self,
        username: String,
    ) -> Result<String, SignalingError> {
        // WebSocket URL erstellen
        let ws_url = format!("{}/ws", self.server_url.replace("http", "ws"));

        tracing::info!("Connecting to signaling server: {}", ws_url);

        // WebSocket verbinden (connect_async expects String/&str)
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| SignalingError::ConnectionFailed(e.to_string()))?;

        let (mut write, mut read) = ws_stream.split();

        // Message-Sender erstellen
        let (tx, mut rx) = mpsc::channel::<String>(100);
        self.tx = Some(tx.clone());

        // State aktualisieren
        {
            let mut state = self.state.write();
            state.is_connected = true;
            state.username = Some(username.clone());
        }

        // Event senden
        let _ = self.event_tx.send(SignalingEvent::Connected);

        // Channel für Registrierungs-Response
        let (reg_tx, mut reg_rx) = mpsc::channel::<Result<String, SignalingError>>(1);

        // Read-Task starten
        let state_clone = Arc::clone(&self.state);
        let event_tx = self.event_tx.clone();
        let reg_tx_clone = reg_tx.clone();

        tokio::spawn(async move {
            while let Some(msg_result) = read.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                            Self::handle_server_message(
                                server_msg,
                                &state_clone,
                                &event_tx,
                                &reg_tx_clone,
                            )
                            .await;
                        }
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("WebSocket closed by server");
                        break;
                    }
                    Err(e) => {
                        tracing::error!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }

            // Disconnect-Status setzen
            {
                let mut state = state_clone.write();
                state.is_connected = false;
            }
            let _ = event_tx.send(SignalingEvent::Disconnected);
        });

        // Write-Task starten
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if let Err(e) = write.send(Message::Text(msg)).await {
                    tracing::error!("Failed to send WebSocket message: {}", e);
                    break;
                }
            }
        });

        // Registrierung senden
        self.send_register(username.clone()).await?;

        // Auf Registrierungs-Response warten (max 10 Sekunden)
        tokio::select! {
            result = reg_rx.recv() => {
                match result {
                    Some(Ok(peer_id)) => Ok(peer_id),
                    Some(Err(e)) => Err(e),
                    None => Err(SignalingError::RegistrationFailed("No response".to_string())),
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(10)) => {
                Err(SignalingError::RegistrationFailed("Timeout".to_string()))
            }
        }
    }

    /// Sendet eine Registrierungs-Nachricht
    async fn send_register(&self, username: String) -> Result<(), SignalingError> {
        let payload = RegisterPayload::new(username, self.keypair.public_key_base64());
        self.send_signed_message(payload).await
    }

    /// Sucht einen Benutzer
    pub async fn find_user(&self, target_username: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = FindUserPayload::new(peer_id, target_username);
        self.send_signed_message(payload).await
    }

    /// Sendet ein SDP Offer
    pub async fn send_offer(&self, to_peer_id: String, sdp: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = OfferPayload::new(peer_id, to_peer_id, sdp);
        self.send_signed_message(payload).await
    }

    /// Sendet ein SDP Answer
    pub async fn send_answer(&self, to_peer_id: String, sdp: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = AnswerPayload::new(peer_id, to_peer_id, sdp);
        self.send_signed_message(payload).await
    }

    /// Sendet einen ICE Candidate
    pub async fn send_ice_candidate(
        &self,
        to_peer_id: String,
        candidate: String,
    ) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = IceCandidatePayload::new(peer_id, to_peer_id, candidate);
        self.send_signed_message(payload).await
    }

    /// Lehnt einen Anruf ab
    pub async fn reject_call(
        &self,
        to_peer_id: String,
        reason: Option<String>,
    ) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = RejectCallPayload::new(peer_id, to_peer_id, reason);
        self.send_signed_message(payload).await
    }

    /// Beendet einen Anruf
    pub async fn hangup(&self, to_peer_id: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = HangupPayload::new(peer_id, to_peer_id);
        self.send_signed_message(payload).await
    }

    /// Sendet einen Heartbeat
    pub async fn send_heartbeat(&self) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = HeartbeatPayload::new(peer_id);
        self.send_signed_message(payload).await
    }

    /// Sendet einen Heartbeat synchron (non-blocking)
    pub fn send_heartbeat_sync(&self) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = HeartbeatPayload::new(peer_id);
        self.send_signed_message_sync(payload)
    }

    /// Gibt den Sender zurück (für thread-safe Zugriff)
    pub fn get_sender(&self) -> Option<mpsc::Sender<String>> {
        self.tx.clone()
    }

    // ========================================================================
    // SYNCHRONE METHODEN (für Verwendung ohne async)
    // ========================================================================

    /// Sucht einen Benutzer synchron (blockiert nicht, verwendet try_send)
    pub fn find_user_sync(&self, target_username: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = FindUserPayload::new(peer_id, target_username);
        self.send_signed_message_sync(payload)
    }

    /// Sendet ein SDP Offer synchron (blockiert nicht, verwendet try_send)
    pub fn send_offer_sync(&self, to_peer_id: String, sdp: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = OfferPayload::new(peer_id, to_peer_id, sdp);
        self.send_signed_message_sync(payload)
    }

    /// Sendet ein SDP Answer synchron
    pub fn send_answer_sync(&self, to_peer_id: String, sdp: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = AnswerPayload::new(peer_id, to_peer_id, sdp);
        self.send_signed_message_sync(payload)
    }

    /// Lehnt einen Anruf synchron ab
    pub fn reject_call_sync(
        &self,
        to_peer_id: String,
        reason: Option<String>,
    ) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = RejectCallPayload::new(peer_id, to_peer_id, reason);
        self.send_signed_message_sync(payload)
    }

    /// Beendet einen Anruf synchron
    pub fn hangup_sync(&self, to_peer_id: String) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = HangupPayload::new(peer_id, to_peer_id);
        self.send_signed_message_sync(payload)
    }

    /// Sendet einen ICE Candidate synchron
    pub fn send_ice_candidate_sync(
        &self,
        to_peer_id: String,
        candidate: String,
    ) -> Result<(), SignalingError> {
        let peer_id = self.peer_id().ok_or(SignalingError::NotConnected)?;
        let payload = IceCandidatePayload::new(peer_id, to_peer_id, candidate);
        self.send_signed_message_sync(payload)
    }

    /// Sendet eine signierte Nachricht synchron (non-blocking)
    fn send_signed_message_sync<T: serde::Serialize>(
        &self,
        payload: T,
    ) -> Result<(), SignalingError> {
        let tx = self.tx.as_ref().ok_or(SignalingError::NotConnected)?;

        // Timestamp hinzufügen
        let timestamp = Utc::now().timestamp_millis();

        // Payload als JSON für Signatur
        let payload_json = serde_json::to_value(&payload)
            .map_err(|e| SignalingError::SendFailed(e.to_string()))?;

        // Signatur erstellen
        let mut signable = payload_json.clone();
        if let Some(obj) = signable.as_object_mut() {
            obj.insert(
                "timestamp".to_string(),
                serde_json::Value::Number(timestamp.into()),
            );
        }
        let signature = self.keypair.sign_message(&signable);

        // Finale Nachricht zusammenstellen
        let mut final_msg = signable;
        if let Some(obj) = final_msg.as_object_mut() {
            obj.insert(
                "signature".to_string(),
                serde_json::Value::String(signature),
            );
        }

        let msg_string = serde_json::to_string(&final_msg)
            .map_err(|e| SignalingError::SendFailed(e.to_string()))?;

        // try_send ist non-blocking
        tx.try_send(msg_string)
            .map_err(|e| SignalingError::SendFailed(e.to_string()))
    }

    /// Sendet eine signierte Nachricht
    async fn send_signed_message<T: serde::Serialize>(
        &self,
        payload: T,
    ) -> Result<(), SignalingError> {
        let tx = self.tx.as_ref().ok_or(SignalingError::NotConnected)?;

        // Timestamp hinzufügen
        let timestamp = Utc::now().timestamp_millis();

        // Payload als JSON für Signatur
        let payload_json = serde_json::to_value(&payload)
            .map_err(|e| SignalingError::SendFailed(e.to_string()))?;

        // Signatur erstellen
        let mut signable = payload_json.clone();
        if let Some(obj) = signable.as_object_mut() {
            obj.insert(
                "timestamp".to_string(),
                serde_json::Value::Number(timestamp.into()),
            );
        }
        let signature = self.keypair.sign_message(&signable);

        // Finale Nachricht zusammenstellen
        let mut final_msg = signable;
        if let Some(obj) = final_msg.as_object_mut() {
            obj.insert(
                "signature".to_string(),
                serde_json::Value::String(signature),
            );
        }

        let msg_string = serde_json::to_string(&final_msg)
            .map_err(|e| SignalingError::SendFailed(e.to_string()))?;

        tx.send(msg_string)
            .await
            .map_err(|e| SignalingError::SendFailed(e.to_string()))
    }

    /// Verarbeitet eingehende Server-Nachrichten
    async fn handle_server_message(
        msg: ServerMessage,
        state: &Arc<RwLock<ClientState>>,
        event_tx: &broadcast::Sender<SignalingEvent>,
        reg_tx: &mpsc::Sender<Result<String, SignalingError>>,
    ) {
        match msg {
            ServerMessage::Registered {
                peer_id, username, ..
            } => {
                tracing::info!("Registered as {} with peer_id {}", username, peer_id);
                {
                    let mut s = state.write();
                    s.peer_id = Some(peer_id.clone());
                    s.username = Some(username.clone());
                }
                let _ = reg_tx.send(Ok(peer_id.clone())).await;
                let _ = event_tx.send(SignalingEvent::Registered { peer_id, username });
            }

            ServerMessage::UserFound {
                peer_id,
                username,
                is_online,
                ..
            } => {
                let _ = event_tx.send(SignalingEvent::UserFound(ContactInfo {
                    peer_id,
                    username,
                    is_online,
                }));
            }

            ServerMessage::UserNotFound { username, .. } => {
                let _ = event_tx.send(SignalingEvent::UserNotFound { username });
            }

            ServerMessage::IncomingOffer {
                from_peer_id,
                from_username,
                sdp,
                ..
            } => {
                let _ = event_tx.send(SignalingEvent::IncomingCall {
                    from_peer_id,
                    from_username,
                    sdp,
                });
            }

            ServerMessage::IncomingAnswer {
                from_peer_id, sdp, ..
            } => {
                let _ = event_tx.send(SignalingEvent::AnswerReceived { from_peer_id, sdp });
            }

            ServerMessage::IncomingIceCandidate {
                from_peer_id,
                candidate,
                ..
            } => {
                let _ = event_tx.send(SignalingEvent::IceCandidateReceived {
                    from_peer_id,
                    candidate,
                });
            }

            ServerMessage::CallRejected {
                by_peer_id, reason, ..
            } => {
                let _ = event_tx.send(SignalingEvent::CallRejected { by_peer_id, reason });
            }

            ServerMessage::CallEnded { by_peer_id, .. } => {
                let _ = event_tx.send(SignalingEvent::CallEnded { by_peer_id });
            }

            ServerMessage::UserOnline { peer_id, .. } => {
                let _ = event_tx.send(SignalingEvent::ContactOnline { peer_id });
            }

            ServerMessage::UserOffline { peer_id, .. } => {
                let _ = event_tx.send(SignalingEvent::ContactOffline { peer_id });
            }

            ServerMessage::Error { code, message, .. } => {
                tracing::error!("Server error {}: {}", code, message);
                // Bei Registrierungs-Fehlern auch dem reg_tx melden
                let _ = reg_tx
                    .send(Err(SignalingError::ServerError {
                        code,
                        message: message.clone(),
                    }))
                    .await;
                let _ = event_tx.send(SignalingEvent::Error { code, message });
            }

            ServerMessage::Pong { .. } => {
                // Heartbeat-Response - nichts zu tun
            }
        }
    }

    /// Startet einen Heartbeat-Task
    pub fn start_heartbeat(self: Arc<Self>) {
        let client = Arc::clone(&self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                if client.is_connected() {
                    if let Err(e) = client.send_heartbeat().await {
                        tracing::warn!("Failed to send heartbeat: {}", e);
                    }
                } else {
                    break;
                }
            }
        });
    }
}

impl std::fmt::Debug for SignalingClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignalingClient")
            .field("server_url", &self.server_url)
            .field("state", &*self.state.read())
            .finish()
    }
}
