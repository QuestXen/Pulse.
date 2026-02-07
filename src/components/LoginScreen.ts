// Login Screen Component

import * as api from '../services/tauri-api';

export interface LoginScreenCallbacks {
  onLogin: (username: string, peerId: string) => void;
}

export function createLoginScreen(callbacks: LoginScreenCallbacks): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'login-screen';
  screen.id = 'login-screen';
  
  screen.innerHTML = `
    <!-- Background Gradient Mesh (CSS) -->
    <div class="login-bg-mesh"></div>

    <div class="login-container">
      <div class="login-header">
         <div class="logo-wrapper" style="display: flex; justify-content: center; margin-bottom: 24px;">
            <div class="app-logo">
              <div class="app-logo-bar left"></div>
              <div class="app-logo-bar center"></div>
              <div class="app-logo-bar right"></div>
            </div>
         </div>
         <h1 class="login-title">Pulse.</h1>
      </div>

      <div class="login-card">
        <div id="login-error" class="error-message hidden"></div>
        
        <form id="login-form" class="login-form">
          <div class="input-group">
            <input 
              type="text" 
              id="username-input" 
              class="input-field minimal" 
              placeholder="Username"
              autocomplete="off"
              spellcheck="false"
              required
              minlength="3"
              maxlength="32"
            />
          </div>
          
          <button type="submit" class="btn btn-primary" id="login-btn" style="width: 100%">
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </button>
        </form>
      </div>

      <div class="login-footer" style="text-align: center; margin-top: 48px; opacity: 0.5; font-size: 12px; color: var(--color-text-muted);">
         <p>Secure P2P • Encrypted • Low Latency</p>
         <p style="margin-top: 8px;">&copy; 2026 Pulse. MIT License.</p>
      </div>
    </div>
  `;
  
  // Event Handlers
  const form = screen.querySelector('#login-form') as HTMLFormElement;
  const usernameInput = screen.querySelector('#username-input') as HTMLInputElement;
  const loginBtn = screen.querySelector('#login-btn') as HTMLButtonElement;
  const errorDiv = screen.querySelector('#login-error') as HTMLDivElement;
  
  function showError(message: string) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    // Shake animation
    const card = screen.querySelector('.login-card') as HTMLElement;
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 500);
  }
  
  function hideError() {
    errorDiv.classList.add('hidden');
  }
  
  function setLoading(loading: boolean) {
    loginBtn.disabled = loading;
    loginBtn.innerHTML = loading ? 
      `Connecting <span class="loading-dots">...</span>` : 
      `Continue <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    usernameInput.disabled = loading;
    if(loading) screen.classList.add('processing');
    else screen.classList.remove('processing');
  }
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    
    const username = usernameInput.value.trim();
    
    if (!username) {
      showError('Please enter a username.');
      return;
    }
    
    if (username.length < 3) {
      showError('Username too short.');
      return;
    }
    
    setLoading(true);
    
    try {
      const peerId = await api.connectAndRegister(username);
      callbacks.onLogin(username, peerId);
    } catch (error) {
      console.error('Login failed:', error);
      showError('Connection failed. Please try again.');
      setLoading(false);
    }
  });
  
  // Focus input on mount
  setTimeout(() => usernameInput.focus(), 100);
  
  return screen;
}
