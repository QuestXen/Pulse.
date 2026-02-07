// Incoming Call Overlay Component

export interface IncomingCallData {
  peerId: string;
  username: string;
  sdp: string;
}

export interface IncomingCallCallbacks {
  onAccept: (data: IncomingCallData) => void;
  onReject: (peerId: string) => void;
}

export function createIncomingCallOverlay(
  data: IncomingCallData,
  callbacks: IncomingCallCallbacks
): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'incoming-call-overlay';
  overlay.id = 'incoming-call-overlay';

  const initials = data.username
    .split(/[\s_-]+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  overlay.innerHTML = `
    <div class="incoming-call-avatar-container">
      <div class="pulse-circle"></div>
      <div class="pulse-circle"></div>
      <div class="pulse-circle"></div>
      <div class="incoming-call-avatar">${initials}</div>
    </div>
    
    <div class="incoming-call-info">
      <div class="incoming-call-name">${escapeHtml(data.username)}</div>
      <div class="incoming-call-status">Incoming Voice Call...</div>
    </div>
    
    <div class="incoming-call-actions">
      <button class="btn btn-icon large btn-danger" id="reject-btn" title="Decline">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <button class="btn btn-icon large btn-success" id="accept-btn" title="Accept">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
      </button>
    </div>
  `;

  const acceptBtn = overlay.querySelector('#accept-btn') as HTMLButtonElement;
  const rejectBtn = overlay.querySelector('#reject-btn') as HTMLButtonElement;

  acceptBtn.addEventListener('click', () => {
    overlay.remove();
    callbacks.onAccept(data);
  });

  rejectBtn.addEventListener('click', () => {
    overlay.remove();
    callbacks.onReject(data.peerId);
  });

  return overlay;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
