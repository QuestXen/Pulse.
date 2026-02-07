// Active Call Screen Component

import * as api from '../services/tauri-api';
import type { CallState } from '../types';
import { AudioVisualizer } from './AudioVisualizer';

export interface CallScreenData {
  peerId: string;
  username: string;
  isOutgoing: boolean;
}

export interface CallScreenCallbacks {
  onHangup: () => void;
}

export function createCallScreen(
  data: CallScreenData,
  callbacks: CallScreenCallbacks
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'call-screen';
  screen.id = 'call-screen';

  const initials = data.username
    .split(/[\s_-]+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  screen.innerHTML = `
    <div class="call-header">
      <div class="call-avatar">${initials}</div>
      <div class="call-name">${escapeHtml(data.username)}</div>
      <div class="call-status" id="call-status">
        ${data.isOutgoing ? 'CONNECTING...' : 'INCOMING...'}
      </div>
      <div class="call-timer hidden" id="call-timer">00:00</div>
    </div>
    
    <!-- Audio Visualizer (ElevenLabs inspired) -->
    <div class="audio-visualizer-wrapper" id="visualizer-wrapper">
        <!-- Visualizer injected here -->
    </div>
    
    <div class="call-controls-dock">
      <button class="control-btn" id="mute-btn" title="Toggle Mute">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
      </button>
      
      <button class="control-btn danger" id="hangup-btn" title="End Call">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
      </button>
    </div>
  `;

  // Elements
  const statusEl = screen.querySelector('#call-status') as HTMLElement;
  const timerEl = screen.querySelector('#call-timer') as HTMLElement;
  const muteBtn = screen.querySelector('#mute-btn') as HTMLButtonElement;
  const hangupBtn = screen.querySelector('#hangup-btn') as HTMLButtonElement;
  const visualizerWrapper = screen.querySelector('#visualizer-wrapper') as HTMLElement;

  // Init Visualizer
  const visualizer = new AudioVisualizer(visualizerWrapper, {
      barCount: 8, // More minimalist count
      minHeight: 8, // Subtle idle state
      maxHeight: 80 // Don't fill entire container
  });

  // Initial State
  if (data.isOutgoing) {
      visualizer.setState("connecting");
  } else {
      visualizer.setState("connecting"); // or ringing?
  }

  let isMuted = false;
  let callStartTime: number | null = null;
  let timerInterval: number | null = null;
  let levelInterval: number | null = null;

  // Mute toggle
  muteBtn.addEventListener('click', async () => {
    isMuted = !isMuted;
    await api.setMuted(isMuted);
    
    if (isMuted) {
      muteBtn.classList.add('active'); // CSS should handle this style (e.g., strike-through icon or white bg)
      muteBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
      muteBtn.style.color = 'var(--color-danger)';
    } else {
      muteBtn.classList.remove('active');
      muteBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
      muteBtn.style.color = '';
    }
  });

  // Hangup
  hangupBtn.addEventListener('click', async () => {
    cleanup();
    await api.hangup();
    callbacks.onHangup();
  });

  // Update call status
  function updateStatus(state: CallState) {
    statusEl.textContent = state.toUpperCase();
    
    // Convert to Visualizer State
    if (state === 'connecting' || state === 'calling' || state === 'ringing') {
        visualizer.setState("connecting");
    } else if (state === 'connected') {
        visualizer.setState("speaking"); // We assume speaking mode once connected, and modulate with volume
        startTimer();
    } else {
        visualizer.setState("idle");
    }

    if (state === 'ended') {
        stopTimer();
    }
  }

  // Call timer
  function startTimer() {
    if (timerInterval) return;
    callStartTime = Date.now();
    timerEl.classList.remove('hidden');
    
    // Hide status text when connected to emphasize visualizer
    statusEl.classList.add('hidden'); 
    
    timerInterval = window.setInterval(() => {
      if (callStartTime) {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerEl.textContent = `${minutes}:${seconds}`;
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Audio level monitoring
  function startLevelMonitoring() {
    levelInterval = window.setInterval(async () => {
      try {
        const [inputLevel, outputLevel] = await api.getAudioLevels();
        const level = Math.max(inputLevel, outputLevel);
        visualizer.updateVolume(level);
      } catch {
         // ignore
      }
    }, 50);
  }

  function stopLevelMonitoring() {
    if (levelInterval) {
      clearInterval(levelInterval);
      levelInterval = null;
    }
  }

  // Cleanup
  function cleanup() {
    stopTimer();
    stopLevelMonitoring();
    visualizer.destroy();
  }

  // Poll call state
  async function pollState() {
    try {
      const state = await api.getCallState();
      updateStatus(state);
      
      if (state === 'connected') {
        if (!levelInterval) startLevelMonitoring();
      } else if (state === 'ended' || state === 'idle') {
        cleanup();
        callbacks.onHangup();
        return;
      }
    } catch {
      // Ignore
    }
    
    // Continue polling
    setTimeout(pollState, 500);
  }

  // Start polling
  pollState();

  // Cleanup on remove
  const originalRemove = screen.remove.bind(screen);
  screen.remove = () => {
    cleanup();
    originalRemove();
  };

  return screen;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
