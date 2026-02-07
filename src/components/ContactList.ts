// Contact List Component

import type { Contact } from '../types';

export interface ContactListCallbacks {
  onCallContact: (contact: Contact) => void;
  onAddContact: () => void;
}

export function createContactList(
  contacts: Contact[],
  callbacks: ContactListCallbacks
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'contact-list';
  container.id = 'contact-list';

  // Separate online and offline contacts
  const onlineContacts = contacts.filter(c => c.is_online);
  const offlineContacts = contacts.filter(c => !c.is_online);

  container.innerHTML = `
    ${onlineContacts.length > 0 ? `
      <div class="contact-list-header">
        <span>Online (${onlineContacts.length})</span>
      </div>
      <div class="contacts-online" id="contacts-online"></div>
    ` : ''}
    
    ${offlineContacts.length > 0 ? `
      <div class="contact-list-header">
        <span>Offline (${offlineContacts.length})</span>
      </div>
      <div class="contacts-offline" id="contacts-offline"></div>
    ` : ''}
    
    ${contacts.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        </div>
        <div class="empty-state-text">
          No contacts yet.
        </div>
      </div>
    ` : ''}
  `;

  // Render online contacts
  const onlineContainer = container.querySelector('#contacts-online');
  if (onlineContainer) {
    onlineContacts.forEach(contact => {
      onlineContainer.appendChild(createContactItem(contact, true));
    });
  }

  // Render offline contacts
  const offlineContainer = container.querySelector('#contacts-offline');
  if (offlineContainer) {
    offlineContacts.forEach(contact => {
      offlineContainer.appendChild(createContactItem(contact, false));
    });
  }

  // Event Delegation for Calls
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('.call-button');
    if (btn) {
      const item = btn.closest('.contact-item') as HTMLElement;
      if (item && item.dataset.peerId) {
        const contact = contacts.find(c => c.peer_id === item.dataset.peerId);
        if (contact) {
            callbacks.onCallContact(contact);
        }
      }
    }
  });

  return container;
}

function createContactItem(
  contact: Contact,
  isOnline: boolean
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'contact-item';
  item.dataset.peerId = contact.peer_id;
  if (isOnline) item.classList.add('active'); // active style implies online/hover

  const displayName = contact.display_name || contact.username;
  const initials = getInitials(displayName);

  item.innerHTML = `
    <div class="contact-avatar">
      ${initials}
      <div class="status-indicator ${isOnline ? 'online' : ''}"></div>
    </div>
    <div class="contact-details">
      <div class="contact-name">${escapeHtml(displayName)}</div>
      <div class="contact-username">@${escapeHtml(contact.username)}</div>
    </div>
    ${isOnline ? `
      <button class="call-button" title="Call">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
      </button>
    ` : ''}
  `;

  return item;
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

// Update a single contact's online status
export function updateContactStatus(peerId: string, isOnline: boolean): void {
  const contactItem = document.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
  if (contactItem) {
    const indicator = contactItem.querySelector('.status-indicator');
    if (indicator) {
      indicator.classList.toggle('online', isOnline);
    }
    
    // Toggle active class (optional style change)
    if (isOnline) contactItem.classList.add('active');
    else contactItem.classList.remove('active');

    // Show/hide call button
    let callBtn = contactItem.querySelector('.call-button');
    
    if (isOnline && !callBtn) {
      // Add call button
      const btn = document.createElement('button');
      btn.className = 'call-button';
      btn.title = 'Call';
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;
      contactItem.appendChild(btn);
    } else if (!isOnline && callBtn) {
      callBtn.remove();
    }
  }
}
