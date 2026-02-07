// P2P Voice Call App - Main Entry Point

import './styles/main.css';
import * as api from './services/tauri-api';
import type { Contact, IncomingCallEvent } from './types';
import { createLoginScreen } from './components/LoginScreen';
import { createContactList, updateContactStatus } from './components/ContactList';
import { createAddContactModal } from './components/AddContactModal';
import { createIncomingCallOverlay, IncomingCallData } from './components/IncomingCall';
import { createCallScreen } from './components/CallScreen';

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
      <button class="btn btn-icon" id="add-contact-btn" title="Add Contact">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
    </div>
    <div class="sidebar-content" id="sidebar-content"></div>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-avatar">${getInitials(state.username || '')}</div>
        <div class="user-details">
          <div class="user-name">${escapeHtml(state.username || '')}</div>
          <div class="user-status">Online</div>
        </div>
      </div>
      <button class="btn btn-icon" id="logout-btn" title="Logout">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
      </button>
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
}

function renderContactList() {
  const sidebarContent = document.getElementById('sidebar-content');
  if (!sidebarContent) return;
  
  sidebarContent.innerHTML = '';
  
  const contactList = createContactList(state.contacts, {
    onCallContact: startCall,
    onAddContact: showAddContactModal,
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
      updateContactStatus(peerId, true);
    }
  });
  
  api.onContactOffline((peerId) => {
    const contact = state.contacts.find(c => c.peer_id === peerId);
    if (contact) {
      contact.is_online = false;
      updateContactStatus(peerId, false);
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
    const userStatus = document.querySelector('.user-status') as HTMLElement | null;
    if (userStatus) {
      userStatus.textContent = 'Offline (Reconnecting...)';
      userStatus.style.color = '#ef4444'; // Red
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
          
          const userStatus = document.querySelector('.user-status') as HTMLElement | null;
          if (userStatus) {
            userStatus.textContent = 'Online';
            userStatus.style.color = ''; // Reset
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

// Start the app
init().catch(console.error);
