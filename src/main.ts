// P2P Voice Call App - Main Entry Point

import './styles/main.css';
import * as api from './services/tauri-api';
import type { Contact, IncomingCallEvent } from './types';
import { createLoginScreen } from './components/LoginScreen';
import { createContactList } from './components/ContactList';
import { createAddContactModal } from './components/AddContactModal';
import { createIncomingCallOverlay, IncomingCallData } from './components/IncomingCall';
import { createCallScreen } from './components/CallScreen';
import { showContextMenu } from './components/ContextMenu';

let reconnectInterval: number | null = null;

function stopReconnect() {
  if (reconnectInterval) {
    window.clearInterval(reconnectInterval);
    reconnectInterval = null;
  }
}

// ============================================================================
// APP STATE
// ============================================================================

interface AppState {
  username: string | null;
  peerId: string | null;
  contacts: Contact[];
  currentScreen: 'login' | 'main' | 'call';
  inCall: boolean;
}

const state: AppState = {
  username: null,
  peerId: null,
  contacts: [],
  currentScreen: 'login',
  inCall: false,
};

// ============================================================================
// DOM REFERENCES
// ============================================================================

const app = document.getElementById('app')!;

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function clearApp() {
  app.innerHTML = '';
}

function renderLoginScreen() {
  clearApp();
  state.currentScreen = 'login';
  
  const loginScreen = createLoginScreen({
    onLogin: async (username, peerId) => {
      state.username = username;
      state.peerId = peerId;
      await loadContacts();
      renderMainScreen();
    }
  });
  
  app.appendChild(loginScreen);
}

function renderMainScreen() {
  clearApp();
  state.currentScreen = 'main';
  
  const layout = document.createElement('div');
  layout.className = 'app-layout';
  
  // Sidebar
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h2 class="sidebar-title">Contacts</h2>
      <button class="action-btn-small" id="add-contact-btn" title="Add Contact">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
    </div>
    
    <div class="sidebar-content" id="sidebar-content"></div>
    
    <!-- New User Profile Dock -->
    <div class="user-profile-dock">
      <div class="user-card-glass">
        <div class="avatar-wrapper">
          <div class="user-avatar-new">${getInitials(state.username || '')}</div>
          <div class="status-dot"></div>
        </div>
        
        <div class="user-info-text">
          <div class="user-name-display" title="${escapeHtml(state.username || '')}">${escapeHtml(state.username || '')}</div>
          <div class="user-id-display" id="copy-id-btn" title="Click to copy ID">
             <span>${state.username ? '@' + state.username : '...'}</span>
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </div>
        </div>

        <div class="user-actions">
           <button class="action-btn-small" id="logout-btn" title="Logout">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
           </button>
        </div>
      </div>
    </div>
  `;
  
  // Main content
  const main = document.createElement('main');
  main.className = 'main-content';
  main.id = 'main-content';
  
  main.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-title">Welcome Back</div>
      <p class="welcome-text">
        Select a contact from the list to start a secure voice call.
      </p>
    </div>
  `;
  
  layout.appendChild(sidebar);
  layout.appendChild(main);
  app.appendChild(layout);
  
  // Render contact list
  renderContactList();
  
  // Event handlers
  const addContactBtn = sidebar.querySelector('#add-contact-btn') as HTMLButtonElement;
  addContactBtn.addEventListener('click', showAddContactModal);
  
  const logoutBtn = sidebar.querySelector('#logout-btn') as HTMLButtonElement;
  logoutBtn.addEventListener('click', logout);

  // Copy ID Logic
  const copyBtn = sidebar.querySelector('#copy-id-btn') as HTMLElement;
  copyBtn.addEventListener('click', () => {
    if (state.username) {
        navigator.clipboard.writeText(state.username).then(() => {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span style="color: var(--color-online)">Copied!</span>';
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
            }, 2000);
        });
    }
  });
}

function renderContactList() {
  const sidebarContent = document.getElementById('sidebar-content');
  if (!sidebarContent) return;
  
  sidebarContent.innerHTML = '';
  
  const contactList = createContactList(state.contacts, {
    onCallContact: startCall,
    onAddContact: showAddContactModal,
    onContextMenu: (contact, x, y) => {
        const items = [
            {
                label: 'Call',
                icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>',
                action: () => startCall(contact),
                // Disable if offline? context menu action handles logic or we can pass disabled prop if we add it
            },
            {
                label: 'Copy ID',
                icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
                action: () => {
                    navigator.clipboard.writeText(contact.peer_id);
                    // Minimal feedback?
                }
            },
            {
                label: 'Remove Contact',
                danger: true,
                icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>',
                action: async () => {
                   if(confirm(`Remove ${contact.display_name || contact.username}?`)) {
                       try {
                           await api.deleteContact(contact.peer_id);
                           state.contacts = state.contacts.filter(c => c.peer_id !== contact.peer_id);
                           renderContactList();
                       } catch (e) {
                           console.error(e);
                           alert('Failed to remove contact');
                       }
                   } 
                }
            }
        ];
        
        // Filter actions based on status?
        // e.g. if offline, maybe verify call action behavior (startCall connects anyway)
        
        showContextMenu(x, y, items);
    }
  });
  
  sidebarContent.appendChild(contactList);
}

function renderCallScreen(peerId: string, username: string, isOutgoing: boolean) {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;
  
  mainContent.innerHTML = '';
  state.inCall = true;
  state.currentScreen = 'call';
  
  const callScreen = createCallScreen(
    { peerId, username, isOutgoing },
    {
      onHangup: () => {
        state.inCall = false;
        renderMainScreen();
      }
    }
  );
  
  mainContent.appendChild(callScreen);
}

// ============================================================================
// ACTIONS
// ============================================================================

async function loadContacts() {
  try {
    state.contacts = await api.getContacts();
  } catch (error) {
    console.error('Failed to load contacts:', error);
  }
}

function showAddContactModal() {
  const modal = createAddContactModal({
    onClose: () => {},
    onContactAdded: async (contact) => {
      state.contacts.push(contact);
      renderContactList();
    },
    existingContacts: state.contacts // Pass existing contacts for duplicate check
  });
  
  document.body.appendChild(modal);
}

async function startCall(contact: Contact) {
  try {
    await api.startCall(contact.peer_id);
    renderCallScreen(contact.peer_id, contact.display_name || contact.username, true);
  } catch (error) {
    console.error('Failed to start call:', error);
    alert('Could not start call: ' + error);
  }
}

async function logout() {
  stopReconnect();
  try {
    await api.disconnect();
  } catch {
    // Ignore
  }
  
  state.username = null;
  state.peerId = null;
  state.contacts = [];
  renderLoginScreen();
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function setupEventListeners() {
  // Incoming call
  api.onIncomingCall((event: IncomingCallEvent) => {
    if (state.inCall) {
      // Reject if already in call
      api.rejectCall(event.fromPeerId, 'busy');
      return;
    }
    
    const overlay = createIncomingCallOverlay(
      {
        peerId: event.fromPeerId,
        username: event.fromUsername,
        sdp: event.sdp,
      },
      {
        onAccept: async (data: IncomingCallData) => {
          try {
            await api.acceptCall(data.peerId, data.sdp);
            renderCallScreen(data.peerId, data.username, false);
          } catch (error) {
            console.error('Failed to accept call:', error);
          }
        },
        onReject: async (peerId: string) => {
          await api.rejectCall(peerId);
        }
      }
    );
    
    document.body.appendChild(overlay);
  });
  
  // Call ended
  api.onCallEnded(() => {
    if (state.inCall) {
      state.inCall = false;
      renderMainScreen();
    }
    
    // Remove incoming call overlay if present
    const overlay = document.getElementById('incoming-call-overlay');
    if (overlay) overlay.remove();
  });
  
  // Call rejected
  api.onCallRejected((event) => {
    if (state.inCall) {
      state.inCall = false;
      alert(`Call rejected: ${event.reason || 'No reason given'}`);
      renderMainScreen();
    }
  });
  
  // Contact online/offline
  api.onContactOnline((peerId) => {
    const contact = state.contacts.find(c => c.peer_id === peerId);
    if (contact) {
      contact.is_online = true;
      renderContactList();
    }
  });
  
  api.onContactOffline((peerId) => {
    const contact = state.contacts.find(c => c.peer_id === peerId);
    if (contact) {
      contact.is_online = false;
      renderContactList();
    }
  });
  
  // Signaling errors
  api.onSignalingError((event) => {
    console.error('Signaling error:', event);
    if (state.currentScreen === 'main') {
      // Could show a toast notification
    }
  });
  
  // Signaling disconnected
  api.onSignalingDisconnected(() => {
    console.warn('Disconnected from signaling server');
    
    // Update UI
    const statusDot = document.querySelector('.user-profile-dock .status-dot') as HTMLElement | null;
    const userIdText = document.querySelector('.user-id-display span') as HTMLElement | null;
    
    if (statusDot) statusDot.style.background = 'var(--color-busy)'; // Red
    if (userIdText) {
        userIdText.textContent = 'Reconnecting...';
        userIdText.parentElement!.style.color = 'var(--color-busy)';
    }

    // Start auto-reconnect
    if (state.username && !reconnectInterval) {
      reconnectInterval = window.setInterval(async () => {
        if (!state.username) {
          stopReconnect();
          return;
        }
        
        try {
          console.log('Reconnecting...');
          await api.connectAndRegister(state.username);
          console.log('Reconnected successfully');
          stopReconnect();
          
          const statusDot = document.querySelector('.user-profile-dock .status-dot') as HTMLElement | null;
          const userIdText = document.querySelector('.user-id-display span') as HTMLElement | null;
          
          if (statusDot) statusDot.style.background = 'var(--color-online)'; // Green
          if (userIdText) {
             userIdText.textContent = state.username ? '@' + state.username : '...';
             userIdText.parentElement!.style.color = ''; // Reset
          }
        } catch (error) {
          console.error('Reconnect attempt failed:', error);
        }
      }, 3000);
    }
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map(word => word[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '??';
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

import { renderLogoPage } from './components/LogoPresentation';
import { createTitleBar } from './components/TitleBar';

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  console.log('Pulse App starting...');
  
  // Custom Route for Logo Presentation
  if (window.location.pathname === '/logo') {
    renderLogoPage();
    return;
  }

  // 1. Render Custom Title Bar
  const titleBar = createTitleBar();
  document.body.prepend(titleBar);
  
  // Setup event listeners
  setupEventListeners();
  
  // Check if already connected
  try {
    const username = await api.getUsername();
    const peerId = await api.getPeerId();
    
    if (username && peerId) {
      state.username = username;
      state.peerId = peerId;
      await loadContacts();
      renderMainScreen();
      return;
    }
  } catch {
    // Not connected
  }
  
  // Show login screen
  renderLoginScreen();
}

// Disable context menu
document.oncontextmenu = (e) => {
  e.preventDefault();
  return false;
};

// Start the app
init().catch(console.error);
