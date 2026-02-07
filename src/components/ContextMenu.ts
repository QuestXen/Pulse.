export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  icon?: string; // Optional icon SVG
}

export function showContextMenu(
  x: number,
  y: number,
  items: ContextMenuItem[]
) {
  // Remove existing context menu if any
  const existing = document.getElementById('custom-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'custom-context-menu';
  menu.className = 'context-menu';
  
  // Calculate position (ensure it doesn't go off screen)
  // We place it temporarily to get dimensions, or just use fixed width assumptions
  // Let's assume width ~200px.
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
    
    // Icon (optional)
    if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'menu-icon';
        iconSpan.innerHTML = item.icon;
        div.appendChild(iconSpan);
    }
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    div.appendChild(labelSpan);
    
    div.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent ensuring click doesn't bubble improperly
        item.action();
        removeMenu();
    });
    
    menu.appendChild(div);
  });

  document.body.appendChild(menu);

  // Auto layout adjustment
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }

  // Click outside to close
  // We use a transparent overlay or document listener
  setTimeout(() => {
    document.addEventListener('click', removeMenu);
    document.addEventListener('contextmenu', removeMenu); // Close on right click elsewhere
  }, 0);

  function removeMenu() {
    menu.remove();
    document.removeEventListener('click', removeMenu);
    document.removeEventListener('contextmenu', removeMenu);
  }
}
