// Audio Visualizer Component (Vanilla TS port of ElevenLabs visualizer)

export type AgentState = "connecting" | "initializing" | "listening" | "speaking" | "thinking" | "idle";

export interface AudioVisualizerOptions {
  barCount?: number;
  minHeight?: number; // percentage
  maxHeight?: number; // percentage
}

export class AudioVisualizer {
  private container: HTMLElement;
  private bars: HTMLElement[] = [];
  private state: AgentState = "idle";
  private options: Required<AudioVisualizerOptions>;
  private animationFrameId: number | null = null;
  
  // Animation state
  private startTime: number = 0;
  private columns: number;
  private indexRef: number = 0;
  
  // Volume simulation state
  private fakeVolumeBands: number[] = [];

  constructor(container: HTMLElement, options: AudioVisualizerOptions = {}) {
    this.container = container;
    this.options = {
      barCount: options.barCount || 12,
      minHeight: options.minHeight || 10,
      maxHeight: options.maxHeight || 100,
    };
    this.columns = this.options.barCount;
    this.fakeVolumeBands = new Array(this.columns).fill(0.1);
    
    this.init();
  }

  private init() {
    this.container.innerHTML = '';
    this.container.classList.add('audio-visualizer-container');
    
    for (let i = 0; i < this.options.barCount; i++) {
        const bar = document.createElement('div');
        bar.className = 'visualizer-bar';
        this.container.appendChild(bar);
        this.bars.push(bar);
    }
    
    this.startAnimationLoop();
  }

  public setState(state: AgentState) {
    if (this.state !== state) {
        this.state = state;
        this.indexRef = 0;
        this.startTime = performance.now();
        // Reset animations if needed
    }
  }

  public updateVolume(level: number) {
    // level is 0.0 to 1.0 (approximated from getAudioLevels)
    // We use this to modulate the amplitude of our fake frequency bands
    this.updateBands(level);
  }

  private updateBands(targetLevel: number) {
    const time = Date.now() / 1000;
    
    for (let i = 0; i < this.columns; i++) {
        // Simulating elevenlabs demo mode logic but scaled by actual input volume
        const waveOffset = i * 0.5;
        // Base sine wave movement - Slower and subtler (speed 5->3, amp 0.3->0.15)
        let val = Math.sin(time * 3 + waveOffset) * 0.15 + 0.4; 
        // Add random noise - reduced (0.2 -> 0.1)
        val += (Math.random() - 0.5) * 0.1;
        
        // Clamp 0-1
        val = Math.max(0.1, Math.min(1, val));
        
        if (targetLevel < 0.01) {
            this.fakeVolumeBands[i] = 0.05; // lower idle state
        } else {
             // Reduced multiplier (2 -> 1.2) for less aggressive spikes
             this.fakeVolumeBands[i] = val * (targetLevel * 1.2); 
        }
    }
  }

  private getHighlightedIndices(): number[] {
    const interval = this.state === "connecting" ? 2000 / this.columns :
                     this.state === "thinking" ? 150 :
                     this.state === "listening" ? 500 : 
                     1000; // default
                     
    // Logic from useBarAnimator
    const now = performance.now();
    const timeElapsed = now - this.startTime;

    if (timeElapsed >= interval) {
        this.indexRef = (this.indexRef + 1); // We wrap modulo later or in sequence logic
        this.startTime = now;
    }

    // Generate sequence based on state
    if (this.state === "connecting" || this.state === "initializing") {
        const step = this.indexRef % Math.ceil(this.columns / 2);
        return [step, this.columns - 1 - step];
    } 
    else if (this.state === "listening") {
        const center = Math.floor(this.columns / 2);
        const step = this.indexRef % 2;
        return step === 0 ? [center] : [];
    }
    else if (this.state === "thinking") {
        return [];
    }
    
    return []; 
  }

  private startAnimationLoop() {
    const animate = () => {
        const highlighted = this.getHighlightedIndices();
        
        this.bars.forEach((bar, index) => {
            let heightPct = this.options.minHeight;
            let isHighlighted = highlighted.includes(index);
            
            if (this.state === "speaking") {
                // When speaking, use volume data
                const vol = this.fakeVolumeBands[index] || 0;
                heightPct = Math.min(this.options.maxHeight, Math.max(this.options.minHeight, vol * 100));
                
                bar.classList.add('active');
            } else if (this.state === "connecting") {
                 // Connecting animation: subtle pulsing (50% -> 30%)
                 heightPct = isHighlighted ? 30 : this.options.minHeight;
                 bar.classList.toggle('active', isHighlighted);
            } else if (this.state === "listening") {
                 heightPct = isHighlighted ? 30 : this.options.minHeight;
                 bar.classList.toggle('active', isHighlighted);
            } else {
                // Idle
                heightPct = this.options.minHeight;
                bar.classList.remove('active');
            }
            
            bar.style.height = `${heightPct}%`;
        });
        
        this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  public destroy() {
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
    }
    this.container.innerHTML = '';
  }
}
