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
          <label class="input-label" for="search-username">USERNAME</label>
          <div class="search-input-wrapper">
             <svg class="search-icon-inside" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
             <input 
               type="text" 
               id="search-username" 
               class="input-field search" 
               placeholder="Search by username..."
               autocomplete="off"
               spellcheck="false"
             />
          </div>
        </div>
        
        <div id="search-result" class="search-result-container hidden"></div>
        <div id="search-error" class="error-message hidden" style="color: var(--color-danger); font-size: 13px; margin-top: 8px;"></div>
      </div>
      
      <div class="modal-footer">
        <!-- Buttons removed from footer, action is inline -->
      </div>
    </div>
  `;

  // Elements
  const closeBtn = overlay.querySelector('#modal-close-btn') as HTMLButtonElement;
  // const cancelBtn = overlay.querySelector('#cancel-btn') as HTMLButtonElement; // Removed
  // const searchBtn = overlay.querySelector('#search-btn') as HTMLButtonElement; // Removed
  const searchInput = overlay.querySelector('#search-username') as HTMLInputElement;
  const resultDiv = overlay.querySelector('#search-result') as HTMLDivElement;
  const errorDiv = overlay.querySelector('#search-error') as HTMLDivElement;

  /* Removed unused foundUser variable */

  // Close handlers
  function close() {
    overlay.remove();
    callbacks.onClose();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  closeBtn.addEventListener('click', close);
  
  // ESC to close
  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', handleEsc);

  // Search logic (debounced)
  let searchTimeout: number;

  function handleSearchInput() {
      const username = searchInput.value.trim();
      
      clearTimeout(searchTimeout);
      resultDiv.classList.add('hidden');
      errorDiv.classList.add('hidden');
      
      if (username.length < 3) return;

      searchTimeout = window.setTimeout(() => {
          performSearch(username);
      }, 500);
  }

  async function performSearch(username: string) {
    try {
      // Set up listener for response
      const unlistenFound = await api.onUserFound((user) => {
        showResult(user);
        unlistenFound();
        unlistenNotFound();
      });

      const unlistenNotFound = await api.onUserNotFound((username) => {
        showError(`User "${username}" not found.`);
        unlistenFound();
        unlistenNotFound();
      });
      
      // Auto-cleanup timeout
       setTimeout(() => {
           unlistenFound();
           unlistenNotFound();
       }, 5000);

      await api.findUser(username);
    } catch (error) {
       showError(error instanceof Error ? error.message : String(error));
    } 
  }

  // ... (showResult, showError, addContact functions remain the same) ...

  function showResult(user: UserFoundEvent) {
    // Check if duplicate
    const isDuplicate = callbacks.existingContacts.some(c => c.peer_id === user.peer_id || c.username === user.username);
    const initials = getInitials(user.username);

    resultDiv.innerHTML = `
      <div class="search-result-item">
        <div class="result-avatar">
          ${initials}
        </div>
        <div class="result-info">
          <div class="result-name">@${escapeHtml(user.username)}</div>
          <div class="result-status">${user.is_online ? 'Online' : 'Offline'}</div>
        </div>
        <button class="add-user-btn" id="add-btn" ${isDuplicate ? 'disabled' : ''}>
            ${isDuplicate ? 'Added' : 'Add'}
        </button>
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
  }

  async function addContact(user: UserFoundEvent) {
    try {
      const btn = resultDiv.querySelector('#add-btn') as HTMLButtonElement;
      if(btn) {
          btn.textContent = 'Adding...';
          btn.disabled = true;
      }
      
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

  // Re-attach listener
  searchInput.addEventListener('input', handleSearchInput);
  
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
