
import { getCurrentWindow } from '@tauri-apps/api/window';

export function createTitleBar(): HTMLElement {
  const titleBar = document.createElement('div');
  titleBar.id = 'titlebar';
  titleBar.className = 'titlebar';
  
  // Important: This attribute makes the element draggable
  titleBar.setAttribute('data-tauri-drag-region', '');

  // Left side: Icon + Title
  const brand = document.createElement('div');
  brand.className = 'titlebar-brand';
  // Also draggable
  brand.setAttribute('data-tauri-drag-region', '');
  
  brand.innerHTML = `
    <div class="titlebar-logo">
      <div class="titlebar-logo-bar left"></div>
      <div class="titlebar-logo-bar center"></div>
      <div class="titlebar-logo-bar right"></div>
    </div>
    <span class="titlebar-text">Pulse.</span>
  `;

  // Right side: Window Controls
  const controls = document.createElement('div');
  controls.className = 'titlebar-controls';

  controls.innerHTML = `
    <button class="titlebar-btn" id="titlebar-minimize" title="Minimize">
      <svg width="10" height="1" viewBox="0 0 10 1"><path d="M0 0h10v1H0z" fill="currentColor"/></svg>
    </button>
    <button class="titlebar-btn" id="titlebar-maximize" title="Maximize">
       <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1h8v8H1V1zm1 1v6h6V2H2z" fill="currentColor"/></svg>
    </button>
    <button class="titlebar-btn close" id="titlebar-close" title="Close">
       <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.1 0L0 1.1l3.9 3.9-3.9 3.9 1.1 1.1 3.9-3.9 3.9 3.9 1.1-1.1-3.9-3.9 3.9-3.9-1.1-1.1-3.9 3.9-3.9-3.9z" fill="currentColor"/></svg>
    </button>
  `;

  titleBar.appendChild(brand);
  titleBar.appendChild(controls);

  // Window Control Logic
  // We use the new Tauri v2 API
  const appWindow = getCurrentWindow();

  titleBar.querySelector('#titlebar-minimize')?.addEventListener('click', () => {
    appWindow.minimize();
  });

  titleBar.querySelector('#titlebar-maximize')?.addEventListener('click', () => {
    appWindow.toggleMaximize();
  });

  titleBar.querySelector('#titlebar-close')?.addEventListener('click', () => {
    appWindow.close();
  });

  return titleBar;
}
