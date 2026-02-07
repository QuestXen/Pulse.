//! WebRTC Call Engine
//!
//! Verwaltet WebRTC Peer Connections und koordiniert
//! Audio Capture/Playback.
//!
//! Hinweis: Opus Encoding wird später hinzugefügt sobald
//! CMake für die opus-sys Bindings verfügbar ist.

use super::audio::{AudioError, AudioHandler, SAMPLE_RATE};
use parking_lot::Mutex;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::broadcast;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum CallEngineError {
    #[error("WebRTC error: {0}")]
    WebRTC(String),

    #[error("Audio error: {0}")]
    Audio(#[from] AudioError),

    #[error("No active call")]
    NoActiveCall,

    #[error("Already in a call")]
    AlreadyInCall,

    #[error("Invalid SDP: {0}")]
    InvalidSdp(String),
}

// ============================================================================
// CALL STATE
// ============================================================================

/// Aktueller Status eines Anrufs
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallState {
    /// Kein aktiver Anruf
    Idle,
    /// Ausgehender Anruf wird aufgebaut
    Calling { peer_id: String },
    /// Eingehender Anruf wartet auf Antwort
    Ringing { peer_id: String, username: String },
    /// Verbindung wird hergestellt
    Connecting { peer_id: String },
    /// Anruf aktiv
    Connected { peer_id: String },
    /// Anruf beendet
    Ended,
}

/// Events die vom CallEngine ausgelöst werden
#[derive(Debug, Clone)]
pub enum CallEvent {
    StateChanged(CallState),
    IceCandidate { candidate: String },
    AudioLevel { input: f32, output: f32 },
    Error(String),
}

// ============================================================================
// ICE SERVER CONFIGURATION
// ============================================================================

/// Standard STUN/TURN Server Konfiguration
pub fn default_ice_servers() -> Vec<RTCIceServer> {
    vec![
        // Google STUN Server (kostenlos, für ~90% der Verbindungen)
        RTCIceServer {
            urls: vec![
                "stun:stun.l.google.com:19302".to_string(),
                "stun:stun1.l.google.com:19302".to_string(),
                "stun:stun2.l.google.com:19302".to_string(),
            ],
            ..Default::default()
        },
    ]
}

// ============================================================================
// CALL ENGINE
// ============================================================================

/// WebRTC Call Engine
pub struct CallEngine {
    state: Arc<Mutex<CallState>>,
    peer_connection: Arc<Mutex<Option<Arc<RTCPeerConnection>>>>,
    audio_handler: Arc<Mutex<Option<AudioHandler>>>,
    event_tx: broadcast::Sender<CallEvent>,
    ice_servers: Vec<RTCIceServer>,
}

impl CallEngine {
    /// Erstellt eine neue CallEngine
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(100);

        Self {
            state: Arc::new(Mutex::new(CallState::Idle)),
            peer_connection: Arc::new(Mutex::new(None)),
            audio_handler: Arc::new(Mutex::new(None)),
            event_tx,
            ice_servers: default_ice_servers(),
        }
    }

    /// Setzt optionale TURN-Server Credentials
    #[allow(dead_code)]
    pub fn set_turn_server(&mut self, url: String, username: String, credential: String) {
        self.ice_servers.push(RTCIceServer {
            urls: vec![url],
            username,
            credential,
            ..Default::default()
        });
    }

    /// Gibt einen Event-Receiver zurück
    pub fn subscribe(&self) -> broadcast::Receiver<CallEvent> {
        self.event_tx.subscribe()
    }

    /// Gibt den aktuellen Call-Status zurück
    pub fn state(&self) -> CallState {
        self.state.lock().clone()
    }

    /// Startet einen ausgehenden Anruf
    ///
    /// Gibt das SDP Offer zurück, das an den Peer gesendet werden muss.
    pub async fn start_call(&self, peer_id: String) -> Result<String, CallEngineError> {
        // Prüfen ob bereits ein Anruf aktiv ist
        {
            let state = self.state.lock();
            if *state != CallState::Idle {
                return Err(CallEngineError::AlreadyInCall);
            }
        }

        // State aktualisieren
        self.set_state(CallState::Calling {
            peer_id: peer_id.clone(),
        });

        // Peer Connection erstellen
        let pc = self.create_peer_connection().await?;

        // Audio Track hinzufügen
        let audio_track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: SAMPLE_RATE,
                channels: 1,
                ..Default::default()
            },
            "audio".to_string(),
            "call-app".to_string(),
        ));

        pc.add_track(Arc::clone(&audio_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // SDP Offer erstellen
        let offer = pc
            .create_offer(None)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Local Description setzen
        pc.set_local_description(offer.clone())
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Peer Connection speichern
        *self.peer_connection.lock() = Some(pc);

        // Audio initialisieren
        self.init_audio()?;

        Ok(offer.sdp)
    }

    /// Akzeptiert einen eingehenden Anruf
    ///
    /// `offer_sdp` ist das SDP Offer vom Anrufer.
    /// Gibt das SDP Answer zurück, das an den Anrufer gesendet werden muss.
    pub async fn accept_call(
        &self,
        peer_id: String,
        offer_sdp: String,
    ) -> Result<String, CallEngineError> {
        // Prüfen ob bereits ein Anruf aktiv ist
        {
            let state = self.state.lock();
            match &*state {
                CallState::Ringing { .. } => {}
                CallState::Idle => {}
                _ => return Err(CallEngineError::AlreadyInCall),
            }
        }

        // State aktualisieren
        self.set_state(CallState::Connecting {
            peer_id: peer_id.clone(),
        });

        // Peer Connection erstellen
        let pc = self.create_peer_connection().await?;

        // Remote Description setzen (das Offer)
        let offer = RTCSessionDescription::offer(offer_sdp)
            .map_err(|e| CallEngineError::InvalidSdp(e.to_string()))?;

        pc.set_remote_description(offer)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Audio Track hinzufügen
        let audio_track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: SAMPLE_RATE,
                channels: 1,
                ..Default::default()
            },
            "audio".to_string(),
            "call-app".to_string(),
        ));

        pc.add_track(Arc::clone(&audio_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // SDP Answer erstellen
        let answer = pc
            .create_answer(None)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Local Description setzen
        pc.set_local_description(answer.clone())
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Peer Connection speichern
        *self.peer_connection.lock() = Some(pc);

        // Audio initialisieren
        self.init_audio()?;

        Ok(answer.sdp)
    }

    /// Verarbeitet das SDP Answer vom Angerufenen
    pub async fn handle_answer(&self, answer_sdp: String) -> Result<(), CallEngineError> {
        let pc = self
            .peer_connection
            .lock()
            .clone()
            .ok_or(CallEngineError::NoActiveCall)?;

        let answer = RTCSessionDescription::answer(answer_sdp)
            .map_err(|e| CallEngineError::InvalidSdp(e.to_string()))?;

        pc.set_remote_description(answer)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        Ok(())
    }

    /// Fügt einen ICE Candidate hinzu
    pub async fn add_ice_candidate(&self, candidate_json: String) -> Result<(), CallEngineError> {
        let pc = self
            .peer_connection
            .lock()
            .clone()
            .ok_or(CallEngineError::NoActiveCall)?;

        let candidate: RTCIceCandidateInit = serde_json::from_str(&candidate_json)
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        pc.add_ice_candidate(candidate)
            .await
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        Ok(())
    }

    /// Lehnt einen eingehenden Anruf ab
    pub fn reject_call(&self) {
        self.end_call();
    }

    /// Beendet den aktuellen Anruf
    pub fn end_call(&self) {
        // Audio stoppen
        if let Some(mut audio) = self.audio_handler.lock().take() {
            audio.stop();
        }

        // Peer Connection schließen
        if let Some(pc) = self.peer_connection.lock().take() {
            tokio::spawn(async move {
                let _ = pc.close().await;
            });
        }

        // State aktualisieren
        self.set_state(CallState::Ended);

        // Kurz warten und dann auf Idle setzen
        let state = Arc::clone(&self.state);
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            *state.lock() = CallState::Idle;
            let _ = event_tx.send(CallEvent::StateChanged(CallState::Idle));
        });
    }

    /// Setzt Mute-Status
    pub fn set_muted(&self, muted: bool) {
        if let Some(audio) = self.audio_handler.lock().as_ref() {
            audio.set_muted(muted);
        }
    }

    /// Gibt Mute-Status zurück
    pub fn is_muted(&self) -> bool {
        self.audio_handler
            .lock()
            .as_ref()
            .map(|a| a.is_muted())
            .unwrap_or(false)
    }

    /// Gibt Audio-Levels zurück (input, output)
    pub fn audio_levels(&self) -> (f32, f32) {
        self.audio_handler
            .lock()
            .as_ref()
            .map(|a| a.get_levels())
            .unwrap_or((0.0, 0.0))
    }

    /// Registriert einen eingehenden Anruf
    pub fn register_incoming_call(&self, peer_id: String, username: String) {
        self.set_state(CallState::Ringing { peer_id, username });
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /// Erstellt eine neue Peer Connection
    async fn create_peer_connection(&self) -> Result<Arc<RTCPeerConnection>, CallEngineError> {
        // Media Engine mit Opus konfigurieren
        let mut media_engine = MediaEngine::default();
        media_engine
            .register_default_codecs()
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // Interceptors für RTCP, NACK etc.
        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut media_engine)
            .map_err(|e| CallEngineError::WebRTC(e.to_string()))?;

        // API erstellen
        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();

        // RTCConfiguration mit ICE Servern
        let config = RTCConfiguration {
            ice_servers: self.ice_servers.clone(),
            ..Default::default()
        };

        // Peer Connection erstellen
        let pc = Arc::new(
            api.new_peer_connection(config)
                .await
                .map_err(|e| CallEngineError::WebRTC(e.to_string()))?,
        );

        // Event Handler registrieren
        self.setup_peer_connection_handlers(Arc::clone(&pc)).await;

        Ok(pc)
    }

    /// Registriert Event Handler für die Peer Connection
    async fn setup_peer_connection_handlers(&self, pc: Arc<RTCPeerConnection>) {
        let state = Arc::clone(&self.state);
        let event_tx = self.event_tx.clone();

        // Connection State Handler
        let state_clone = Arc::clone(&state);
        let event_tx_clone = event_tx.clone();
        pc.on_peer_connection_state_change(Box::new(move |s: RTCPeerConnectionState| {
            tracing::info!("Peer connection state: {:?}", s);

            let new_state = match s {
                RTCPeerConnectionState::Connected => {
                    let current = state_clone.lock();
                    if let CallState::Connecting { ref peer_id }
                    | CallState::Calling { ref peer_id } = *current
                    {
                        Some(CallState::Connected {
                            peer_id: peer_id.clone(),
                        })
                    } else {
                        None
                    }
                }
                RTCPeerConnectionState::Disconnected
                | RTCPeerConnectionState::Failed
                | RTCPeerConnectionState::Closed => Some(CallState::Ended),
                _ => None,
            };

            if let Some(new_state) = new_state {
                *state_clone.lock() = new_state.clone();
                let _ = event_tx_clone.send(CallEvent::StateChanged(new_state));
            }

            Box::pin(async {})
        }));

        // ICE Candidate Handler
        let event_tx_clone = event_tx.clone();
        pc.on_ice_candidate(Box::new(move |candidate| {
            if let Some(c) = candidate {
                if let Ok(json) = c.to_json() {
                    if let Ok(candidate_str) = serde_json::to_string(&json) {
                        let _ = event_tx_clone.send(CallEvent::IceCandidate {
                            candidate: candidate_str,
                        });
                    }
                }
            }
            Box::pin(async {})
        }));

        // Track Handler (für eingehendes Audio)
        // TODO: Echtes Audio-Handling implementieren wenn Opus verfügbar ist
        pc.on_track(Box::new(move |track, _, _| {
            Box::pin(async move {
                tracing::info!("Received track: {:?}", track.codec());
                // Placeholder: Audio-Handling wird später implementiert
                // wenn Opus Encoding/Decoding verfügbar ist
            })
        }));
    }

    /// Initialisiert Audio
    fn init_audio(&self) -> Result<(), CallEngineError> {
        // Audio Handler erstellen
        let mut audio = AudioHandler::new()?;
        audio.start_capture()?;
        audio.start_playback()?;
        *self.audio_handler.lock() = Some(audio);

        // TODO: Opus Encoder/Decoder hinzufügen wenn CMake verfügbar

        Ok(())
    }

    /// Aktualisiert den State und sendet Event
    fn set_state(&self, new_state: CallState) {
        *self.state.lock() = new_state.clone();
        let _ = self.event_tx.send(CallEvent::StateChanged(new_state));
    }
}

impl Default for CallEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for CallEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CallEngine")
            .field("state", &self.state())
            .field("is_muted", &self.is_muted())
            .finish()
    }
}
