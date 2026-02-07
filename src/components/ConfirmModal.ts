export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function showConfirmModal(options: ConfirmModalOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  // Close on click outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">${options.title}</h3>
      <button class="modal-close-btn">&times;</button>
    </div>
    <div class="modal-body">
      <p style="color: var(--color-text-muted); font-size: 14px; line-height: 1.5;">${options.message}</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost cancel-btn">${options.cancelText || 'Cancel'}</button>
      <button class="btn ${options.isDanger ? 'btn-danger' : 'btn-primary'} confirm-btn">${options.confirmText || 'Confirm'}</button>
    </div>
  `;

  const close = () => {
    overlay.classList.add('fade-out'); // Add CSS animation class if exists, or just remove
    setTimeout(() => {
        document.body.removeChild(overlay);
        if (options.onCancel) options.onCancel();
    }, 100);
  };

  const confirmAction = () => {
    options.onConfirm();
    document.body.removeChild(overlay);
  };
  
  // Event listeners
  const closeBtn = modal.querySelector('.modal-close-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const confirmBtn = modal.querySelector('.confirm-btn');

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmAction);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Animation if modal supports it
  requestAnimationFrame(() => {
      // Assuming CSS handles transition if classes are set correctly
  });
}
