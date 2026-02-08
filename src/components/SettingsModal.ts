// Settings Modal Component

import * as api from '../services/tauri-api';

export interface SettingsModalCallbacks {
  onClose: () => void;
}

interface AudioDevice {
  name: string;
  is_default: boolean;
}

export function createSettingsModal(callbacks: SettingsModalCallbacks): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settings-modal';

  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="modal-close" id="modal-close-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="modal-body settings-body">
        <!-- Audio Settings Section -->
        <div class="settings-section">
          <h3 class="settings-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            Audio
          </h3>
          
          <!-- Volume Control -->
          <div class="settings-item">
            <label class="settings-label">Volume</label>
            <div class="volume-control">
              <svg class="volume-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
              <input type="range" id="volume-slider" class="volume-slider" min="0" max="100" value="100" />
              <span class="volume-value" id="volume-value">100%</span>
            </div>
          </div>
          
          <!-- Input Device -->
          <div class="settings-item">
            <label class="settings-label">Microphone</label>
            <div class="select-wrapper">
              <select id="input-device" class="settings-select">
                <option value="">Loading...</option>
              </select>
              <svg class="select-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          
          <!-- Output Device -->
          <div class="settings-item">
            <label class="settings-label">Speaker</label>
            <div class="select-wrapper">
              <select id="output-device" class="settings-select">
                <option value="">Loading...</option>
              </select>
              <svg class="select-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>
        
        <!-- About Section -->
        <div class="settings-section">
          <h3 class="settings-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            About
          </h3>
          
          <div class="settings-item about-item">
            <div class="app-info">
              <div class="app-name">Pulse</div>
              <div class="app-version">Version 0.1.0</div>
              <div class="app-description">Secure P2P Voice Calls</div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-primary" id="save-settings-btn">Done</button>
      </div>
    </div>
  `;

  // Elements
  const closeBtn = overlay.querySelector('#modal-close-btn') as HTMLButtonElement;
  const saveBtn = overlay.querySelector('#save-settings-btn') as HTMLButtonElement;
  const volumeSlider = overlay.querySelector('#volume-slider') as HTMLInputElement;
  const volumeValue = overlay.querySelector('#volume-value') as HTMLSpanElement;
  const inputDeviceSelect = overlay.querySelector('#input-device') as HTMLSelectElement;
  const outputDeviceSelect = overlay.querySelector('#output-device') as HTMLSelectElement;

  // Close handlers
  function close() {
    overlay.remove();
    callbacks.onClose();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  closeBtn.addEventListener('click', close);
  saveBtn.addEventListener('click', close);
  
  // ESC to close
  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', handleEsc);

  // Volume slider
  volumeSlider.addEventListener('input', () => {
    const value = volumeSlider.value;
    volumeValue.textContent = `${value}%`;
    // Volume is stored in localStorage for now (until backend support)
    localStorage.setItem('pulse_volume', value);
  });

  // Load saved volume
  const savedVolume = localStorage.getItem('pulse_volume') || '100';
  volumeSlider.value = savedVolume;
  volumeValue.textContent = `${savedVolume}%`;

  // Load audio devices
  loadAudioDevices();

  async function loadAudioDevices() {
    try {
      const [inputDevices, outputDevices] = await api.getAudioDevices();
      
      // Populate input devices
      inputDeviceSelect.innerHTML = '';
      if (inputDevices.length === 0) {
        inputDeviceSelect.innerHTML = '<option value="">No microphones found</option>';
      } else {
        inputDevices.forEach((device: AudioDevice) => {
          const option = document.createElement('option');
          option.value = device.name;
          option.textContent = device.name;
          if (device.is_default) {
            option.selected = true;
            option.textContent = `${device.name} (Default)`;
          }
          inputDeviceSelect.appendChild(option);
        });
      }
      
      // Populate output devices
      outputDeviceSelect.innerHTML = '';
      if (outputDevices.length === 0) {
        outputDeviceSelect.innerHTML = '<option value="">No speakers found</option>';
      } else {
        outputDevices.forEach((device: AudioDevice) => {
          const option = document.createElement('option');
          option.value = device.name;
          option.textContent = device.name;
          if (device.is_default) {
            option.selected = true;
            option.textContent = `${device.name} (Default)`;
          }
          outputDeviceSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Failed to load audio devices:', error);
      inputDeviceSelect.innerHTML = '<option value="">Error loading devices</option>';
      outputDeviceSelect.innerHTML = '<option value="">Error loading devices</option>';
    }
  }

  // Cleanup
  const originalRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    document.removeEventListener('keydown', handleEsc);
    originalRemove();
  };

  return overlay;
}
