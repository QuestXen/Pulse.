# P2P Voice Call App - Implementation Plan

## 🎯 Projekt-Übersicht

Eine minimalistische, serverlose P2P Voice-Call-Applikation mit:

- **Cloudflare Worker** als Signaling-Server
- **Tauri + Rust** Backend für WebRTC & Audio
- **Web Frontend** mit Discord-ähnlichem Dark Theme
- **Auto-Update System** für nahtlose Updates

---

## 📋 Meilensteine

### Meilenstein 1: Cloudflare Worker (Signaling Server)

**Status:** ✅ Abgeschlossen & Deployed!

**URL:** `https://call-app-signaling.questxen.workers.dev`

**Features:**

- [x] User Registration (Username → Peer-ID)
- [x] WebSocket Verbindungen für Echtzeit-Signaling
- [x] Online/Offline Status Tracking
- [x] SDP Offer/Answer Relay
- [x] ICE Candidate Exchange
- [x] Ed25519 Signatur-Verifizierung
- [x] Kontaktsuche

**Testing:** ✅ Lokal getestet mit wrangler dev + test-client.ts

---

### Meilenstein 2: Rust Backend (Core Logic)

**Status:** ✅ Abgeschlossen

**Features:**

- [x] Ed25519 Schlüsselpaar-Generierung (crypto/)
- [x] SignalingClient (WebSocket zu Worker)
- [x] CallEngine mit WebRTC (webrtc-rs)
- [x] Audio Capture/Playback (cpal)
- [x] SQLite für lokale Kontakte
- [x] Tauri Commands für Frontend

**Optional:** Opus Codec (erfordert vcpkg - siehe unten)

**Testing:** ✅ Kompiliert erfolgreich

---

### Meilenstein 3: Frontend UI

**Status:** ✅ Abgeschlossen

**Features:**

- [x] Login/Registration Screen
- [x] Kontaktliste mit Online-Status
- [x] Kontakt hinzufügen (Benutzersuche Modal)
- [x] Eingehender Anruf Benachrichtigung
- [x] Aktiver Anruf UI (Mute/Timer/End)
- [x] Audio Level Visualisierung

**Tech Stack:** Vanilla TypeScript + CSS

**Design:** Minimalistisches Discord-inspiriertes Dark Theme

**Komponenten:**

- `LoginScreen.ts` - Login-Formular mit Validierung
- `ContactList.ts` - Online/Offline gruppierte Kontakte
- `AddContactModal.ts` - Benutzersuche & hinzufügen
- `IncomingCall.ts` - Eingehender Anruf Overlay
- `CallScreen.ts` - Aktiver Anruf mit Timer & Mute

---

### Meilenstein 4: Auto-Update System

**Status:** ⏳ Wartend

**Features:**

- [ ] Automatische Update-Prüfung beim App-Start
- [ ] Manuelle Update-Prüfung über UI-Button
- [ ] Download-Progress-Anzeige
- [ ] GitHub Actions für automatische Builds
- [ ] Code-Signing für Windows/macOS

---

## 🚀 Cloudflare Worker Deployment

### Voraussetzungen

1. Cloudflare Account (kostenlos: https://dash.cloudflare.com/sign-up)
2. Node.js installiert
3. Wrangler CLI

### Schritt-für-Schritt Anleitung

```powershell
# 1. In das Worker-Verzeichnis wechseln
cd d:\Rust\call-app\cloudflare-worker

# 2. Wrangler CLI installieren (falls nicht vorhanden)
npm install -g wrangler

# 3. Bei Cloudflare anmelden (Browser öffnet sich)
npx wrangler login

# 4. Dependencies installieren
npm install

# 5. Optional: Lokal testen
npx wrangler dev

# 6. Worker deployen
npx wrangler deploy
```

### Nach dem Deployment

Die Konsole zeigt dir eine URL wie:

```
https://p2p-voice-signaling.<dein-account>.workers.dev
```

Diese URL musst du in der App konfigurieren:

**Option A: Umgebungsvariable setzen (empfohlen):**

```powershell
# In PowerShell
$env:SIGNALING_URL = "https://p2p-voice-signaling.dein-account.workers.dev"

# Dann App starten
pnpm tauri dev
```

**Option B: Im Code ändern:**
Öffne `src-tauri/src/lib.rs` und ersetze die Standard-URL.

### Kosten

- **Free Tier:** 100.000 Requests/Tag
- Für persönliche Nutzung völlig ausreichend!

---

## 🎵 Opus Codec (Optional - Beste Audio-Qualität)

Opus bietet deutlich bessere Kompression und Qualität als Raw PCM.
Die Integration erfordert die Installation von vcpkg.

### vcpkg Installation

```powershell
# 1. vcpkg klonen
git clone https://github.com/microsoft/vcpkg C:\vcpkg
cd C:\vcpkg

# 2. Bootstrap ausführen
.\bootstrap-vcpkg.bat

# 3. Opus installieren (für 64-bit Windows)
.\vcpkg install opus:x64-windows-static

# 4. Umgebungsvariablen setzen (in System-Umgebungsvariablen hinzufügen)
# VCPKG_ROOT = C:\vcpkg
```

### In Cargo.toml aktivieren

Öffne `src-tauri/Cargo.toml` und ersetze:

```toml
# audiopus = "0.3.0-rc.0"
```

mit:

```toml
audiopus = "0.3.0-rc.0"
```

Dann die audio.rs mit Opus-Support erweitern (Codebeispiel auf Anfrage).

---

## 🏗️ Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                             │
│                   (Cloudflare Worker)                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Durable Object                                              │ │
│  │  ├── User Registry (username → peer_id)                     │ │
│  │  ├── Public Keys (peer_id → ed25519_pubkey)                │ │
│  │  └── Online Status                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Signaling Messages
                              │
         ┌────────────────────┴────────────────────┐
         ▼                                          ▼
┌─────────────────┐                      ┌─────────────────┐
│   Client A      │                      │   Client B      │
│  (Tauri App)    │◄────────────────────►│  (Tauri App)    │
│                 │   P2P WebRTC Audio   │                 │
│  ├── Frontend   │                      │  ├── Frontend   │
│  └── Rust Core  │                      │  └── Rust Core  │
└─────────────────┘                      └─────────────────┘
```

---

## 📁 Projektstruktur

```
call-app/
├── cloudflare-worker/           # ✅ Signaling Server
│   ├── src/
│   │   ├── index.ts            # Worker Entry
│   │   ├── durable-object.ts   # State Management
│   │   ├── crypto.ts           # Ed25519 Verification
│   │   └── types.ts            # TypeScript Types
│   ├── wrangler.toml           # Cloudflare Config
│   └── package.json
│
├── src-tauri/                   # ✅ Rust Backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs              # Tauri Commands
│   │   ├── crypto/             # Ed25519 Signing
│   │   ├── signaling/          # WebSocket Client
│   │   ├── call_engine/        # WebRTC + Audio
│   │   └── database/           # SQLite Contacts
│   └── Cargo.toml
│
├── src/                         # ✅ Frontend (Vanilla TS)
│   ├── main.ts                 # Entry Point
│   ├── styles/
│   │   └── main.css            # Dark Theme
│   ├── components/
│   │   ├── LoginScreen.ts
│   │   ├── ContactList.ts
│   │   ├── AddContactModal.ts
│   │   ├── IncomingCall.ts
│   │   └── CallScreen.ts
│   ├── services/
│   │   └── tauri-api.ts
│   └── types/
│       └── index.ts
│
└── index.html
```

---

## 🔐 Sicherheitsmodell

1. **Ed25519 Schlüsselpaar** wird beim ersten Start generiert
2. **Public Key** wird bei Registrierung beim Worker hinterlegt
3. **Jede Signaling-Nachricht** wird mit Private Key signiert
4. **Worker verifiziert** Signaturen vor dem Relay
5. **WebRTC DTLS** verschlüsselt Audio Ende-zu-Ende

---

## 🌐 ICE/STUN Konfiguration

```javascript
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];
```

Für restriktive Netzwerke (doppeltes NAT) wird ein TURN-Server benötigt.

---

## 📝 Nächste Schritte

1. ✅ Backend kompiliert
2. ✅ Frontend implementiert
3. ⏳ **Worker deployen** (siehe Anleitung oben)
4. ⏳ App testen
5. ⏳ Optional: Opus Codec aktivieren
6. ⏳ Auto-Update System (Meilenstein 4)
