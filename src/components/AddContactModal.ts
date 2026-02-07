// Add Contact Modal Component

import type { UserFoundEvent, Contact } from '../types';
import * as api from '../services/tauri-api';

export interface AddContactModalCallbacks {
  onClose: () => void;
  onContactAdded: (contact: Contact) => void;
  existingContacts: Contact[]; // Passed in to check for duplicates
}

export function createAddContactModal(callbacks: AddContactModalCallbacks): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'add-contact-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Add Contact</h2>
        <button class="modal-close" id="modal-close-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="modal-body">
        <div class="input-group">
          <label class="input-label" for="search-username">Search by Username</label>
          <input 
            type="text" 
            id="search-username" 
            class="input-field" 
            placeholder="e.g. alice_123"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        
        <div id="search-result" class="hidden"></div>
        <div id="search-error" class="error-message hidden"></div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="search-btn">Search</button>
      </div>
    </div>
  `;

  // Elements
  const closeBtn = overlay.querySelector('#modal-close-btn') as HTMLButtonElement;
  const cancelBtn = overlay.querySelector('#cancel-btn') as HTMLButtonElement;
  const searchBtn = overlay.querySelector('#search-btn') as HTMLButtonElement;
  const searchInput = overlay.querySelector('#search-username') as HTMLInputElement;
  const resultDiv = overlay.querySelector('#search-result') as HTMLDivElement;
  const errorDiv = overlay.querySelector('#search-error') as HTMLDivElement;

  let foundUser: UserFoundEvent | null = null;

  // Close handlers
  function close() {
    overlay.remove();
    callbacks.onClose();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  // ESC to close
  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', handleEsc);

  // Search
  async function search() {
    const username = searchInput.value.trim();
    if (!username) return;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    resultDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    resultDiv.innerHTML = '';

    try {
      // Set up listener for response
      const unlistenFound = await api.onUserFound((user) => {
        foundUser = user;
        showResult(user);
        unlistenFound();
        unlistenNotFound();
      });

      const unlistenNotFound = await api.onUserNotFound((username) => {
        showError(`User "${username}" not found.`);
        unlistenFound();
        unlistenNotFound();
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        unlistenFound();
        unlistenNotFound();
        if (!foundUser && searchBtn.disabled) { // only if still searching
          showError('Search timed out.');
           searchBtn.disabled = false;
           searchBtn.textContent = 'Search';
        }
      }, 10000);

      await api.findUser(username);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
       searchBtn.disabled = false;
       searchBtn.textContent = 'Search';
    } 
  }

  function showResult(user: UserFoundEvent) {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
    
    // Check if duplicate
    const isDuplicate = callbacks.existingContacts.some(c => c.peer_id === user.peer_id || c.username === user.username);

    resultDiv.innerHTML = `
      <div class="search-result">
        <div class="contact-avatar">
          ${getInitials(user.username)}
        </div>
        <div class="search-result-info">
          <div class="search-result-name">@${escapeHtml(user.username)}</div>
          <div class="search-result-status">${user.is_online ? 'Online' : 'Offline'}</div>
        </div>
        ${isDuplicate 
          ? `<button class="btn btn-secondary" disabled>Added</button>`
          : `<button class="btn btn-primary" id="add-btn">Add</button>`
        }
      </div>
    `;
    resultDiv.classList.remove('hidden');

    if (!isDuplicate) {
        const addBtn = resultDiv.querySelector('#add-btn') as HTMLButtonElement;
        addBtn.addEventListener('click', () => addContact(user));
    }
  }

  function showError(message: string) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    // Ensure button is reset
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }

  async function addContact(user: UserFoundEvent) {
    try {
      const contact = await api.addContact({
        peer_id: user.peer_id,
        username: user.username,
      });
      callbacks.onContactAdded(contact);
      close();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  searchBtn.addEventListener('click', search);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search();
    }
  });

  // Focus input
  setTimeout(() => searchInput.focus(), 100);

  // Cleanup
  const originalRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    document.removeEventListener('keydown', handleEsc);
    originalRemove();
  };

  return overlay;
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
