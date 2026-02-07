// Contact List Component

import type { Contact } from '../types';

export interface ContactListCallbacks {
  onCallContact: (contact: Contact) => void;
  onAddContact: () => void;
  onContextMenu: (contact: Contact, x: number, y: number) => void;
}

export function createContactList(
  contacts: Contact[],
  callbacks: ContactListCallbacks
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'contact-list-new';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '20px';

  // Separate online and offline contacts
  const onlineContacts = contacts.filter(c => c.is_online);
  const offlineContacts = contacts.filter(c => !c.is_online);

  if (contacts.length === 0) {
      container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; color: var(--color-text-muted); text-align: center; opacity: 0.6;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <div style="font-size: 13px;">No contacts yet.<br>Add someone to start calling.</div>
      </div>
      `;
      return container;
  }

  let draggingItem: HTMLElement | null = null;
  
  // Helper to create a section
  const createSection = (title: string, list: Contact[]) => {
      if (list.length === 0) return '';
      
      const section = document.createElement('div');
      section.className = 'contact-section';
      
      const header = document.createElement('div');
      header.style.fontSize = '11px';
      header.style.fontWeight = '600';
      header.style.color = 'var(--color-text-muted)';
      header.style.textTransform = 'uppercase';
      header.style.marginBottom = '8px';
      header.style.paddingLeft = '12px';
      header.style.letterSpacing = '0.05em';
      header.textContent = `${title} — ${list.length}`;
      
      section.appendChild(header);
      
      list.forEach(contact => {
          const item = createContactItem(contact);
          
          item.addEventListener('dragstart', (e) => {
              draggingItem = item;
              item.classList.add('dragging');
              if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', contact.peer_id); // Required for Firefox
              }
              // setTimeout to verify visual hiding if needed, but opacity CSS handles it
          });

          item.addEventListener('dragend', () => {
              item.classList.remove('dragging');
              draggingItem = null;
          });

          item.addEventListener('dragenter', (e) => {
              e.preventDefault();
              if (draggingItem && draggingItem !== item) {
                  // Ensure we are in the same section
                  const parent = item.parentNode;
                  if (parent && parent === draggingItem.parentNode) {
                      const children = Array.from(parent.children);
                      const draggingIndex = children.indexOf(draggingItem);
                      const targetIndex = children.indexOf(item);
                      
                      if (draggingIndex < targetIndex) {
                          parent.insertBefore(draggingItem, item.nextSibling);
                      } else {
                          parent.insertBefore(draggingItem, item);
                      }
                  }
              }
          });
          
          // Necessary to allow dropping
          item.addEventListener('dragover', (e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          });
          
          section.appendChild(item);
      });
      
      // Allow dropping into the section (e.g. at the end)
      section.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (draggingItem && section.contains(draggingItem) === false && draggingItem.className.includes('contact-item-new')) {
              // Handle cross-section drag if we ever allow it
              // For now, restrictive
          }
      });
      
      return section;
  };

  const onlineSection = createSection('Online', onlineContacts);
  if (onlineSection) container.appendChild(onlineSection);

  const offlineSection = createSection('Offline', offlineContacts);
  if (offlineSection) container.appendChild(offlineSection);

  // Click Handler
  container.addEventListener('click', (e) => {
    // If we were dragging, ignore click
    if (isDraggingGlobal) return;

    const target = e.target as HTMLElement;
    const item = target.closest('.contact-item-new') as HTMLElement;
    
    // Only trigger if clicking the item itself or a child
    if (item && item.dataset.peerId && item.dataset.online === 'true') {
        const contact = contacts.find(c => c.peer_id === item.dataset.peerId);
        if (contact) {
            callbacks.onCallContact(contact);
        }
    }
  });

  // Context Menu Handler
  container.addEventListener('contextmenu', (e) => {
    if (isDraggingGlobal) return;

    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target as HTMLElement;
    const item = target.closest('.contact-item-new') as HTMLElement;

    if (item && item.dataset.peerId) {
        const contact = contacts.find(c => c.peer_id === item.dataset.peerId);
        if (contact) {
            callbacks.onContextMenu(contact, e.clientX, e.clientY);
        }
    }
  });

  return container;
}

let isDraggingGlobal = false;

function createContactItem(contact: Contact): HTMLElement {
  const item = document.createElement('div');
  item.className = 'contact-item-new';
  item.dataset.peerId = contact.peer_id;
  item.dataset.online = contact.is_online ? 'true' : 'false';
  // Standard Drag API disabled 
  item.draggable = false; 

  const displayName = contact.display_name || contact.username;
  const initials = getInitials(displayName);

  // We rely on CSS for the layout defined in main.css .contact-item-new
  item.innerHTML = `
    <div class="avatar-wrapper" style="width: 36px; height: 36px; pointer-events: none;">
       <div class="user-avatar-new" style="font-size: 12px; background: ${contact.is_online ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3f3f46, #27272a)'}; border-color: ${contact.is_online ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.05)'}">${initials}</div>
       ${contact.is_online ? '<div class="status-dot"></div>' : ''}
    </div>
    <div class="contact-info" style="pointer-events: none;">
       <div class="contact-name">${escapeHtml(displayName)}</div>
       <div class="contact-status-text">${contact.is_online ? 'Available' : 'Offline'}</div>
    </div>
    ${contact.is_online ? `
    <div class="action-btn-small" style="background: rgba(255,255,255,0.05); pointer-events: none;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16.7 3.3a2 2 0 0 0-2.6 2.6"></path></svg>
    </div>
    ` : ''}
  `;

  setupCustomDrag(item);

  return item;
}

function setupCustomDrag(item: HTMLElement) {
    let clone: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    
    // Prevent default interactions
    item.style.touchAction = 'none'; 
    item.style.userSelect = 'none';

    const onPointerDown = (e: PointerEvent) => {
        // Only left click
        if (e.button !== 0) return;
        
        // Prevent text selection start
        e.preventDefault();
        
        // Note: We intentionally DO NOT use setPointerCapture here because moving the element 
        // in the DOM (swapping) can sometimes cause capture to be lost or behave erratically.
        // Instead, we attach listeners to window.
        
        startX = e.clientX;
        startY = e.clientY;
        
        isDraggingGlobal = false; 

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // Threshold to start drag
        if (!isDraggingGlobal && Math.sqrt(dx*dx + dy*dy) > 5) {
            isDraggingGlobal = true;
            startDrag();
        }

        if (isDraggingGlobal && clone) {
            clone.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px)`;
            
            // Interaction Check (Swap Logic)
            checkSwap(e.clientX, e.clientY);
        }
    };

    const startDrag = () => {
        // Create Clone
        clone = item.cloneNode(true) as HTMLElement;
        clone.classList.add('drag-clone');
        // Match geometry
        const rect = item.getBoundingClientRect();
        clone.style.position = 'fixed';
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.zIndex = '9999';
        clone.style.pointerEvents = 'none'; 
        
        document.body.appendChild(clone);
        item.classList.add('drag-placeholder');
    };
    
    const checkSwap = (x: number, y: number) => {
        // We use elementFromPoint because it's faster and handles z-index naturally
        const element = document.elementFromPoint(x, y);
        if (!element) return;
        
        const targetItem = element.closest('.contact-item-new') as HTMLElement;
        
        // Ensure we are swapping with a valid target in the same container
        if (targetItem && targetItem !== item && !targetItem.classList.contains('drag-clone') && targetItem.parentNode === item.parentNode) {
            
            const parent = item.parentNode!;
            // Check relative DOM position
            const children = Array.from(parent.children);
            const curIndex = children.indexOf(item);
            const targetIndex = children.indexOf(targetItem);
            
            // Swap logic
            if (curIndex < targetIndex) {
                 // Moving down: insert after target
                 parent.insertBefore(item, targetItem.nextSibling);
            } else {
                 // Moving up: insert before target
                 parent.insertBefore(item, targetItem);
            }
        }
    };

    const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (clone) {
            clone.remove();
            clone = null;
        }
        item.classList.remove('drag-placeholder');
        
        // Reset flag after a short delay
        setTimeout(() => {
            isDraggingGlobal = false;
        }, 50);
    };

    item.addEventListener('pointerdown', onPointerDown);
}
    
function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function updateContactStatus(peerId: string, isOnline: boolean): void {
  // Since we have separate sections for Online/Offline, the simplest way to update sort order 
  // without a full re-render framework is complex. 
  // However, for this MVP, we can just find the item and update its visual state.
  // Ideally, main.ts should trigger a re-render of the list on status change.
  // But let's at least update the visual indicator.
  
  const item = document.querySelector(`.contact-item-new[data-peer-id="${peerId}"]`) as HTMLElement;
  if (item) {
      item.dataset.online = isOnline ? 'true' : 'false';
      
      const avatar = item.querySelector('.user-avatar-new') as HTMLElement;
      if (avatar) {
          avatar.style.background = isOnline ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3f3f46, #27272a)';
          avatar.style.borderColor = isOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.05)';
      }
      
      const statusText = item.querySelector('.contact-status-text');
      if (statusText) statusText.textContent = isOnline ? 'Available' : 'Offline';
      
      // We should really allow main.ts to re-render the list to move it to the correct section,
      // but if we do this in-place:
      const wrapper = item.querySelector('.avatar-wrapper');
      if (wrapper) {
          const existingDot = wrapper.querySelector('.status-dot');
          if (isOnline && !existingDot) {
              const dot = document.createElement('div');
              dot.className = 'status-dot';
              wrapper.appendChild(dot);
          } else if (!isOnline && existingDot) {
              existingDot.remove();
          }
      }
  }
}
