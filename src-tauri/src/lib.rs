//! Call App - P2P Voice Call Application
//!
//! Eine serverlose P2P Voice-Call-Applikation mit:
//! - Cloudflare Worker als Signaling-Server
//! - WebRTC für P2P Audio-Kommunikation
//! - Ed25519 Authentifizierung
//! - SQLite für lokale Kontakte

pub mod call_engine;
pub mod crypto;
pub mod database;
pub mod signaling;

use call_engine::{CallEngine, CallEvent, CallState};
use crypto::KeyPair;
use database::{Contact, ContactsDatabase, NewContact};
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use signaling::{SignalingClient, SignalingEvent};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

// ============================================================================
// APPLICATION STATE
// ============================================================================

/// Globaler Application State
pub struct AppState {
    keypair: Arc<KeyPair>,
    signaling: Arc<RwLock<Option<SignalingClient>>>,
    call_engine: Arc<CallEngine>,
    database: Arc<ContactsDatabase>,
    signaling_url: String,
}

/// Singleton für den AppState
static APP_STATE: OnceCell<Arc<AppState>> = OnceCell::new();

impl AppState {
    /// Initialisiert den Application State
    pub fn init(signaling_url: String) -> Result<Arc<Self>, String> {
        // Logging initialisieren
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::from_default_env()
                    .add_directive("call_app=debug".parse().unwrap())
                    .add_directive("webrtc=warn".parse().unwrap()),
            )
            .init();

        tracing::info!("Initializing Call App...");

        // KeyPair laden oder erstellen
        let keypair = KeyPair::load_or_create().map_err(|e| e.to_string())?;
        tracing::info!("Loaded keypair: {:?}", keypair);

        // Database öffnen
        let database = ContactsDatabase::open().map_err(|e| e.to_string())?;
        tracing::info!("Database opened");

        // Alle Kontakte auf offline setzen (frischer Start)
        database.set_all_offline().map_err(|e| e.to_string())?;

        let state = Arc::new(Self {
            keypair: Arc::new(keypair),
            signaling: Arc::new(RwLock::new(None)),
            call_engine: Arc::new(CallEngine::new()),
            database: Arc::new(database),
            signaling_url,
        });

        APP_STATE
            .set(Arc::clone(&state))
            .map_err(|_| "AppState already initialized")?;

        Ok(state)
    }

    /// Gibt den globalen AppState zurück
    pub fn get() -> Option<Arc<Self>> {
        APP_STATE.get().cloned()
    }
}

// ============================================================================
// TAURI COMMANDS - IDENTITY
// ============================================================================

/// Gibt den Public Key des Benutzers zurück
#[tauri::command]
async fn get_public_key(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.keypair.public_key_base64())
}

/// Gibt die aktuelle Peer ID zurück (falls registriert)
#[tauri::command]
async fn get_peer_id(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    let signaling = state.signaling.read();
    Ok(signaling.as_ref().and_then(|s| s.peer_id()))
}

/// Gibt den aktuellen Username zurück (falls registriert)
#[tauri::command]
async fn get_username(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    let signaling = state.signaling.read();
    Ok(signaling.as_ref().and_then(|s| s.username()))
}

// ============================================================================
// TAURI COMMANDS - SIGNALING
// ============================================================================

/// Verbindet mit dem Signaling-Server und registriert den Benutzer
#[tauri::command]
async fn connect_and_register(
    username: String,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<String, String> {
    tracing::info!("Connecting as '{}'...", username);

    // Signaling Client erstellen
    let mut client = SignalingClient::new(state.signaling_url.clone(), Arc::clone(&state.keypair));

    // Event Handler starten
    let mut event_rx = client.subscribe();
    let app_handle_clone = app_handle.clone();
    let database = Arc::clone(&state.database);
    let call_engine = Arc::clone(&state.call_engine);

    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            handle_signaling_event(event, &app_handle_clone, &database, &call_engine).await;
        }
    });

    // Verbinden und registrieren
    let peer_id = client
        .connect_and_register(username)
        .await
        .map_err(|e| e.to_string())?;

    // Client speichern
    *state.signaling.write() = Some(client);

    // Call Engine Event Handler starten für ICE Candidates
    let mut call_event_rx = state.call_engine.subscribe();
    let signaling_ref = Arc::clone(&state.signaling);
    let app_handle_clone = app_handle.clone();
    let call_engine_ref = Arc::clone(&state.call_engine);

    tokio::spawn(async move {
        while let Ok(event) = call_event_rx.recv().await {
            match event {
                CallEvent::IceCandidate { candidate } => {
                    tracing::debug!("Sending ICE candidate to peer");

                    // Peer ID aus dem Call-State holen
                    let target_peer_id = match call_engine_ref.state() {
                        CallState::Calling { peer_id } => Some(peer_id),
                        CallState::Connecting { peer_id } => Some(peer_id),
                        CallState::Connected { peer_id } => Some(peer_id),
                        CallState::Ringing { peer_id, .. } => Some(peer_id),
                        _ => None,
                    };

                    if let Some(target_peer_id) = target_peer_id {
                        // ICE Candidate über Signaling senden
                        let signaling = signaling_ref.read();
                        if let Some(ref client) = *signaling {
                            if let Err(e) = client
                                .send_ice_candidate_sync(target_peer_id.clone(), candidate.clone())
                            {
                                tracing::error!("Failed to send ICE candidate: {}", e);
                            }
                        }
                    }

                    // Auch ans Frontend senden für Debugging
                    let _ = app_handle_clone.emit("call:ice_candidate", &candidate);
                }
                CallEvent::StateChanged(new_state) => {
                    tracing::info!("Call state changed: {:?}", new_state);
                    let _ = app_handle_clone.emit(
                        "call:state_changed",
                        serde_json::to_string(&format!("{:?}", new_state)).unwrap_or_default(),
                    );
                }
                CallEvent::Error(err) => {
                    tracing::error!("Call error: {}", err);
                    let _ = app_handle_clone.emit("call:error", &err);
                }
                _ => {}
            }
        }
    });

    // Heartbeat-Task starten, um WebSocket-Verbindung aufrechtzuerhalten
    // Cloudflare Workers hat einen Idle-Timeout, daher müssen wir regelmäßig Heartbeats senden
    let signaling_ref = Arc::clone(&state.signaling);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(25));
        loop {
            interval.tick().await;

            let should_continue = {
                let signaling = signaling_ref.read();
                if let Some(client) = signaling.as_ref() {
                    if client.is_connected() {
                        // Heartbeat senden (synchron um den Lock nicht zu lange zu halten)
                        let _ = client.send_heartbeat_sync();
                        true
                    } else {
                        tracing::info!("Heartbeat: Client disconnected, stopping heartbeat task");
                        false
                    }
                } else {
                    tracing::info!("Heartbeat: No client, stopping heartbeat task");
                    false
                }
            };

            if !should_continue {
                break;
            }
        }
    });

    tracing::info!("Registered with peer_id: {}", peer_id);
    Ok(peer_id)
}

/// Trennt die Verbindung zum Signaling-Server
#[tauri::command]
async fn disconnect(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    *state.signaling.write() = None;
    Ok(())
}

/// Sucht einen Benutzer anhand des Usernamens
#[tauri::command]
async fn find_user(username: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    tracing::info!("Searching for user: {}", username);

    let signaling = state.signaling.read();
    let client = signaling.as_ref().ok_or("Not connected")?;

    if !client.is_connected() {
        return Err("Not connected".to_string());
    }

    // Synchrone find_user Methode verwenden
    client
        .find_user_sync(username.clone())
        .map_err(|e| e.to_string())?;

    tracing::info!("Find user request sent for: {}", username);
    Ok(())
}

// ============================================================================
// TAURI COMMANDS - CONTACTS
// ============================================================================

/// Gibt alle Kontakte zurück
#[tauri::command]
async fn get_contacts(state: State<'_, Arc<AppState>>) -> Result<Vec<Contact>, String> {
    state.database.get_all_contacts().map_err(|e| e.to_string())
}

/// Fügt einen neuen Kontakt hinzu
#[tauri::command]
async fn add_contact(
    peer_id: String,
    username: String,
    display_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Contact, String> {
    state
        .database
        .add_contact(NewContact {
            peer_id,
            username,
            display_name,
        })
        .map_err(|e| e.to_string())
}

/// Löscht einen Kontakt
#[tauri::command]
async fn delete_contact(peer_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state
        .database
        .delete_contact(&peer_id)
        .map_err(|e| e.to_string())
}

/// Aktualisiert den Display-Namen eines Kontakts
#[tauri::command]
async fn update_contact_name(
    peer_id: String,
    display_name: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .database
        .set_display_name(&peer_id, display_name.as_deref())
        .map_err(|e| e.to_string())
}

/// Fragt den Online-Status aller Kontakte beim Server ab
/// Sollte nach dem Login aufgerufen werden
#[tauri::command]
async fn refresh_contact_statuses(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    tracing::info!("Refreshing contact statuses...");

    // Hole alle Kontakte aus der Datenbank
    let contacts = state
        .database
        .get_all_contacts()
        .map_err(|e| e.to_string())?;

    // Für jeden Kontakt eine find_user Anfrage senden (über username)
    let signaling = state.signaling.read();
    let client = signaling.as_ref().ok_or("Not connected")?;

    if !client.is_connected() {
        return Err("Not connected".to_string());
    }

    for contact in contacts {
        // find_user sendet eine Anfrage an den Server
        // Das Ergebnis kommt als SignalingEvent::UserFound zurück
        // und wird dann in handle_signaling_event verarbeitet
        if let Err(e) = client.find_user_sync(contact.username.clone()) {
            tracing::warn!("Failed to refresh status for {}: {}", contact.username, e);
        }
    }

    tracing::info!("Contact status refresh requests sent");
    Ok(())
}

// ============================================================================
// TAURI COMMANDS - CALLS
// ============================================================================

/// Startet einen ausgehenden Anruf
#[tauri::command]
async fn start_call(peer_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    tracing::info!("Starting call to {}", peer_id);

    // Call Engine ist bereits Arc und thread-safe
    let call_engine = Arc::clone(&state.call_engine);

    // SDP Offer erstellen
    let offer_sdp = call_engine
        .start_call(peer_id.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Sender klonen VOR dem await
    let sender = {
        let signaling = state.signaling.read();
        signaling.as_ref().and_then(|c| c.get_sender())
    };

    // Wenn wir keinen Sender haben, Fehler
    let _tx = sender.ok_or("Not connected")?;

    // Offer über geklonten Sender schicken
    // TODO: Diese Logik sollte in SignalingClient gekapselt werden

    // Fallback: Erneut Lock und hoffen dass es schnell geht
    {
        let signaling = state.signaling.read();
        if let Some(client) = signaling.as_ref() {
            // Direkte synchrones Senden - nicht ideal aber funktioniert
            let _ = client.send_offer_sync(peer_id, offer_sdp);
        }
    }

    Ok(())
}

/// Akzeptiert einen eingehenden Anruf
#[tauri::command]
async fn accept_call(
    peer_id: String,
    offer_sdp: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    tracing::info!("Accepting call from {}", peer_id);

    let call_engine = Arc::clone(&state.call_engine);

    // SDP Answer erstellen
    let answer_sdp = call_engine
        .accept_call(peer_id.clone(), offer_sdp)
        .await
        .map_err(|e| e.to_string())?;

    // Answer senden
    {
        let signaling = state.signaling.read();
        if let Some(client) = signaling.as_ref() {
            let _ = client.send_answer_sync(peer_id, answer_sdp);
        }
    }

    Ok(())
}

/// Lehnt einen eingehenden Anruf ab
#[tauri::command]
async fn reject_call(
    peer_id: String,
    reason: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    tracing::info!("Rejecting call from {}", peer_id);

    state.call_engine.reject_call();

    {
        let signaling = state.signaling.read();
        if let Some(client) = signaling.as_ref() {
            let _ = client.reject_call_sync(peer_id, reason);
        }
    }

    Ok(())
}

/// Beendet den aktuellen Anruf
#[tauri::command]
async fn hangup(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    tracing::info!("Hanging up");

    let peer_id = match state.call_engine.state() {
        CallState::Connected { peer_id }
        | CallState::Calling { peer_id }
        | CallState::Connecting { peer_id }
        | CallState::Ringing { peer_id, .. } => peer_id,
        _ => return Err("No active call".to_string()),
    };

    state.call_engine.end_call();

    {
        let signaling = state.signaling.read();
        if let Some(client) = signaling.as_ref() {
            let _ = client.hangup_sync(peer_id);
        }
    }

    Ok(())
}

/// Gibt den aktuellen Call-Status zurück
#[tauri::command]
async fn get_call_state(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let call_state = state.call_engine.state();
    let state_str = match call_state {
        CallState::Idle => "idle",
        CallState::Calling { .. } => "calling",
        CallState::Ringing { .. } => "ringing",
        CallState::Connecting { .. } => "connecting",
        CallState::Connected { .. } => "connected",
        CallState::Ended => "ended",
    };
    Ok(state_str.to_string())
}

/// Setzt Mute-Status
#[tauri::command]
async fn set_muted(muted: bool, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.call_engine.set_muted(muted);
    Ok(())
}

/// Gibt Mute-Status zurück
#[tauri::command]
async fn is_muted(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(state.call_engine.is_muted())
}

/// Gibt Audio-Levels zurück (input, output)
#[tauri::command]
async fn get_audio_levels(state: State<'_, Arc<AppState>>) -> Result<(f32, f32), String> {
    Ok(state.call_engine.audio_levels())
}

// ============================================================================
// TAURI COMMANDS - AUDIO SETTINGS
// ============================================================================

/// Repräsentiert ein Audio-Gerät
#[derive(serde::Serialize)]
struct AudioDevice {
    name: String,
    is_default: bool,
}

/// Gibt alle verfügbaren Audio-Geräte zurück
#[tauri::command]
async fn get_audio_devices() -> Result<(Vec<AudioDevice>, Vec<AudioDevice>), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();

    let default_input = host.default_input_device().and_then(|d| d.name().ok());
    let default_output = host.default_output_device().and_then(|d| d.name().ok());

    let input_devices: Vec<AudioDevice> = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| {
            d.name().ok().map(|name| AudioDevice {
                is_default: Some(&name) == default_input.as_ref(),
                name,
            })
        })
        .collect();

    let output_devices: Vec<AudioDevice> = host
        .output_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| {
            d.name().ok().map(|name| AudioDevice {
                is_default: Some(&name) == default_output.as_ref(),
                name,
            })
        })
        .collect();

    Ok((input_devices, output_devices))
}

// ============================================================================
// EVENT HANDLER
// ============================================================================

/// Verarbeitet Signaling-Events und leitet sie an das Frontend weiter
async fn handle_signaling_event(
    event: SignalingEvent,
    app_handle: &AppHandle,
    database: &Arc<ContactsDatabase>,
    call_engine: &Arc<CallEngine>,
) {
    match event {
        SignalingEvent::Connected => {
            tracing::info!("Connected to signaling server");
            let _ = app_handle.emit("signaling:connected", ());
        }

        SignalingEvent::Disconnected => {
            tracing::info!("Disconnected from signaling server");
            let _ = app_handle.emit("signaling:disconnected", ());
        }

        SignalingEvent::Registered { peer_id, username } => {
            tracing::info!("Registered as {} (peer_id: {})", username, peer_id);
            let _ = app_handle.emit(
                "signaling:registered",
                serde_json::json!({
                    "peerId": peer_id,
                    "username": username
                }),
            );
        }

        SignalingEvent::UserFound(contact) => {
            tracing::info!("User found: {:?}", contact);
            // Update the online status in the database
            let _ = database.set_online_status(&contact.peer_id, contact.is_online);
            let _ = app_handle.emit("signaling:user_found", &contact);
        }

        SignalingEvent::UserNotFound { username } => {
            tracing::info!("User not found: {}", username);
            let _ = app_handle.emit("signaling:user_not_found", username);
        }

        SignalingEvent::IncomingCall {
            from_peer_id,
            from_username,
            sdp,
        } => {
            tracing::info!("Incoming call from {} ({})", from_username, from_peer_id);

            // Call Engine über eingehenden Anruf informieren
            call_engine.register_incoming_call(from_peer_id.clone(), from_username.clone());

            let _ = app_handle.emit(
                "call:incoming",
                serde_json::json!({
                    "fromPeerId": from_peer_id,
                    "fromUsername": from_username,
                    "sdp": sdp
                }),
            );
        }

        SignalingEvent::AnswerReceived { from_peer_id, sdp } => {
            tracing::info!("Answer received from {}", from_peer_id);

            // SDP Answer verarbeiten
            if let Err(e) = call_engine.handle_answer(sdp).await {
                tracing::error!("Failed to handle answer: {}", e);
            }

            let _ = app_handle.emit("call:answer_received", from_peer_id);
        }

        SignalingEvent::IceCandidateReceived {
            from_peer_id,
            candidate,
        } => {
            tracing::debug!("ICE candidate from {}", from_peer_id);

            // ICE Candidate hinzufügen
            if let Err(e) = call_engine.add_ice_candidate(candidate).await {
                tracing::error!("Failed to add ICE candidate: {}", e);
            }
        }

        SignalingEvent::CallRejected { by_peer_id, reason } => {
            tracing::info!("Call rejected by {} (reason: {:?})", by_peer_id, reason);
            call_engine.end_call();
            let _ = app_handle.emit(
                "call:rejected",
                serde_json::json!({
                    "byPeerId": by_peer_id,
                    "reason": reason
                }),
            );
        }

        SignalingEvent::CallEnded { by_peer_id } => {
            tracing::info!("Call ended by {}", by_peer_id);
            call_engine.end_call();
            let _ = app_handle.emit("call:ended", by_peer_id);
        }

        SignalingEvent::ContactOnline { peer_id } => {
            tracing::info!("Contact online: {}", peer_id);
            let _ = database.set_online_status(&peer_id, true);
            let _ = app_handle.emit("contact:online", &peer_id);
        }

        SignalingEvent::ContactOffline { peer_id } => {
            tracing::info!("Contact offline: {}", peer_id);
            let _ = database.set_online_status(&peer_id, false);
            let _ = app_handle.emit("contact:offline", &peer_id);
        }

        SignalingEvent::Error { code, message } => {
            tracing::error!("Signaling error {}: {}", code, message);
            let _ = app_handle.emit(
                "signaling:error",
                serde_json::json!({
                    "code": code,
                    "message": message
                }),
            );
        }
    }
}

// ============================================================================
// TAURI APP RUNNER
// ============================================================================

/// Startet die Tauri-Anwendung
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default Signaling URL (kann über Umgebungsvariable überschrieben werden)
    let signaling_url = std::env::var("SIGNALING_URL")
        .unwrap_or_else(|_| "https://call-app-signaling.questxen.workers.dev".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    // Start of context menu disabling
                    window
                        .with_webview(move |_webview| {
                            #[cfg(target_os = "windows")]
                            {
                                // Requires 'webview2-com' crate for Windows-specific bindings
                                // unsafe {
                                //     use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings;
                                //     let core = webview.controller().CoreWebView2().unwrap();
                                //     let settings: ICoreWebView2Settings = core.Settings().unwrap();
                                //     let _ = settings.SetAreDefaultContextMenusEnabled(0);
                                // }

                                // NOTE: Since we might not have webview2-com in Cargo.toml yet,
                                // we keep this commented out to prevent build errors.
                                // The Javascript 'document.oncontextmenu' fix in main.ts is the primary fix for now.
                            }
                        })
                        .expect("failed to execute with_webview");
                }
            }

            // App State initialisieren
            let state =
                AppState::init(signaling_url.clone()).expect("Failed to initialize app state");

            // State im Tauri-App registrieren
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Identity
            get_public_key,
            get_peer_id,
            get_username,
            // Signaling
            connect_and_register,
            disconnect,
            find_user,
            // Contacts
            get_contacts,
            add_contact,
            delete_contact,
            update_contact_name,
            refresh_contact_statuses,
            // Calls
            start_call,
            accept_call,
            reject_call,
            hangup,
            get_call_state,
            set_muted,
            is_muted,
            get_audio_levels,
            // Audio Settings
            get_audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
