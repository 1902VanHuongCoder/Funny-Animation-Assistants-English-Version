/** 
 * WebAudioKit - Modern Web Audio API wrapper library 
 *  
 * Features: 
 * - Automatic AudioContext state management (Suspend/Resume) 
 * - Resource preloading and caching 
 * - Smooth fade algorithms (Fade In: Exponential, Fade Out: Linear) 
 * - Pause and resume support (automatic offset tracking) 
 */ 
  
export interface PlayOptions { 
  volume?: number;      // 0.0 ~ 1.0 (default 1.0) 
  loop?: boolean;       // Loop playback (default false) 
  fadeIn?: number;      // Fade in duration (seconds) 
  startOffset?: number; // Start offset (seconds) 
} 
  
export interface AudioInstance { 
  id: string; 
  stop: (fadeOutDuration?: number) => void; 
  pause: () => void; 
  resume: () => void; 
  setVolume: (val: number, rampTime?: number) => void; 
  seek: (time: number) => void; 
  isPlaying: boolean; 
  hasEnded: boolean; 
  duration: number; // Total audio duration 
} 

class WebAudioKit { 
  private ctx: AudioContext | null = null; 
  private bufferCache = new Map<string, AudioBuffer>(); 
  // Active playing instances for global control 
  private activeInstances = new Map<string, InternalSoundInstance>(); 
  
  constructor() { 
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; 
    if (AudioContextClass) { 
      this.ctx = new AudioContext(); 
    } else { 
      console.warn('WebAudioKit: Current browser does not support Web Audio API'); 
    } 
  } 
  
  /** 
   * Initialize or resume context 
   * Must be called during user interaction to satisfy browser autoplay policies 
   */ 
  public async init(): Promise<void> { 
    if (!this.ctx) return; 
    if (this.ctx.state === 'suspended') { 
      await this.ctx.resume(); 
    } 
  } 
  
  /** 
   * Get native Context (for advanced operations) 
   */ 
  public getContext(): AudioContext | null { 
    return this.ctx; 
  } 
  
  /** 
   * Load audio resource 
   * @param url Audio URL 
   */ 
  public async load(url: string): Promise<AudioBuffer | null> { 
    if (!this.ctx) return null; 
     
    // 1. Check cache 
    if (this.bufferCache.has(url)) { 
      return this.bufferCache.get(url)!; 
    } 
  
    try { 
      // 2. Fetch 
      const response = await fetch(url); 
      const arrayBuffer = await response.arrayBuffer(); 
       
      // 3. Decode 
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer); 
      this.bufferCache.set(url, audioBuffer); 
      return audioBuffer; 
    } catch (err) { 
      console.error(`[WebAudioKit] Failed to load: ${url}`, err); 
      return null; 
    } 
  } 
  
  /** 
   * Play audio 
   * @param url Audio URL (preloaded or automatically loaded here) 
   * @param options Playback options 
   * @returns AudioInstance control handle 
   */ 
  public async play(url: string, options: PlayOptions = {}): Promise<AudioInstance | null> { 
    if (!this.ctx) return null; 
  
    // Ensure resource is loaded 
    let buffer = this.bufferCache.get(url); 
    buffer ??= (await this.load(url)) ?? undefined; 
    if (!buffer) return null; 
  
    const id = Math.random().toString(36).substr(2, 9); 
    const instance = new InternalSoundInstance(this.ctx, buffer, options); 
     
    // Bind cleanup callback 
    instance.onEnded = () => { 
      this.activeInstances.delete(id); 
    }; 
  
    this.activeInstances.set(id, instance); 
    instance.start(); 
  
    // Return exposed API handle 
    return { 
      id, 
      duration: buffer.duration, 
      get isPlaying() { return instance.isPlaying; }, 
      get hasEnded() { return instance.hasEnded; }, 
      stop: (d) => instance.stop(d), 
      pause: () => instance.pause(), 
      resume: () => instance.resume(), 
      setVolume: (v, t) => instance.setVolume(v, t), 
      seek: (t) => instance.seek(t) 
    }; 
  } 
  
  /** 
   * Stop all currently playing sounds 
   */ 
  public stopAll(fadeOutDuration = 0) { 
    this.activeInstances.forEach(inst => inst.stop(fadeOutDuration)); 
    this.activeInstances.clear(); 
  } 

  /** 
   * Unload cached audio resource 
   */ 
  public unload(url: string) { 
    if (this.bufferCache.has(url)) { 
      this.bufferCache.delete(url); 
    } 
  } 
} 
  
/** 
 * Internal sound instance class 
 * Encapsulates lifecycle of SourceNode and GainNode 
 */ 
class InternalSoundInstance { 
  private ctx: AudioContext; 
  private buffer: AudioBuffer; 
   
  private source: AudioBufferSourceNode | null = null; 
  private gain: GainNode | null = null; 
   
  // State tracking 
  private _isPlaying = false; 
  private _hasEnded = false; 
  private _startTime = 0; // Context time when started 
  private _startOffset = 0; // Buffer offset 
  private _options: PlayOptions; 
   
  // External callback 
  public onEnded: (() => void) | null = null; 
  
  constructor(ctx: AudioContext, buffer: AudioBuffer, options: PlayOptions) { 
    this.ctx = ctx; 
    this.buffer = buffer; 
    this._options = { 
      volume: 1.0, 
      loop: false, 
      fadeIn: 0, 
      startOffset: 0, 
      ...options 
    }; 
    this._startOffset = this._options.startOffset ?? 0; 
  } 
  
  get isPlaying() { return this._isPlaying; } 
  get hasEnded() { return this._hasEnded; } 

  /** 
   * Start playback (or recreate nodes to play) 
   */ 
  public start() { 
    if (this._isPlaying) return; 

    this._hasEnded = false; 

    // 1. Create nodes 
    this.source = this.ctx.createBufferSource(); 
    this.source.buffer = this.buffer; 
    this.source.loop = !!this._options.loop; 
  
    this.gain = this.ctx.createGain(); 
     
    // 2. Audio graph connection: Source -> Gain -> Destination 
    this.source.connect(this.gain); 
    this.gain.connect(this.ctx.destination); 
  
    // 3. Initial volume / fade in 
    const now = this.ctx.currentTime; 
    const targetVol = this._options.volume ?? 1.0; 
    const fadeIn = this._options.fadeIn ?? 0; 
  
    // Reset scheduled changes 
    this.gain.gain.cancelScheduledValues(now); 
  
    if (fadeIn > 0) { 
      // Exponential fade in (more natural) 
      this.gain.gain.setValueAtTime(0.001, now); 
      this.gain.gain.exponentialRampToValueAtTime(targetVol, now + fadeIn); 
    } else { 
      this.gain.gain.setValueAtTime(targetVol, now); 
    } 
  
    // 4. Start playback 
    // Handle loop offset 
    let playOffset = this._startOffset; 
    if (this._options.loop) { 
      playOffset = playOffset % this.buffer.duration; 
    } 

    // 4.5 Auto fade out (for non-looping playback only, prevents clipping/pops at audio end) 
    if (!this._options.loop) { 
      const bufferDuration = this.buffer.duration; 
      const remainingDuration = bufferDuration - playOffset; 
      const AUTO_FADE_OUT = 0.1; // 0.1s fade out 

      // Apply fade out if remaining time suffices without colliding with fade in 
      if (remainingDuration > AUTO_FADE_OUT && remainingDuration > (fadeIn || 0) + AUTO_FADE_OUT) { 
        const fadeOutStartTime = now + remainingDuration - AUTO_FADE_OUT; 
        const endTime = now + remainingDuration; 
         
        // Anchor current volume value before fade out 
        this.gain.gain.setValueAtTime(targetVol, fadeOutStartTime); 
        // Linear fade out to tiny value (0.0001 avoids edge case issues with zero) 
        this.gain.gain.linearRampToValueAtTime(0.0001, endTime); 
      } 
    } 
  
    this.source.start(now, playOffset); 
     
    // 5. Update state 
    this._startTime = now; 
    this._isPlaying = true; 
  
    // 6. Bind native ended event 
    this.source.onended = () => { 
      // Trigger callback only for natural ends (manual stop() clears source before onended) 
      if (this._isPlaying) { 
        this._isPlaying = false; 
        this._hasEnded = true; 
        if (this.onEnded) this.onEnded(); 
      } 
    }; 
  } 
  
  /** 
   * Pause (records progress and stops node) 
   */ 
  public pause() { 
    if (!this._isPlaying) return; 
     
    // Calculate progress at pause 
    const elapsed = this.ctx.currentTime - this._startTime; 
    this._startOffset = (this._startOffset + elapsed) % this.buffer.duration; 
     
    this.stopNode(); // Stop node only, avoid triggering onEnded cleanup 
    this._isPlaying = false; 
  } 
  
  /** 
   * Resume 
   */ 
  public resume() { 
    if (this._isPlaying) return; 
    // Carry over options with short fade in to avoid clipping 
    const resumeOpts = { ...this._options, fadeIn: 0.1 }; 
    this._options = resumeOpts; 
    this.start(); 
  } 
  
  /** 
   * Stop playback 
   * @param fadeOutDuration Fade out duration (seconds) 
   */ 
  public stop(fadeOutDuration = 0) { 
    if (!this._isPlaying || !this.gain || !this.source) return; 

    // For looping playback with fade out, unloop so source ends cleanly 
    if (this._options.loop && fadeOutDuration > 0) { 
      this.source.loop = false; 
    } 

    if (fadeOutDuration > 0) { 
      // === Best practice fade-out logic === 
      const now = this.ctx.currentTime; 
       
      // 1. Cancel future volume changes 
      this.gain.gain.cancelScheduledValues(now); 
       
      // 2. Anchor current volume (prevents step changes) 
      this.gain.gain.setValueAtTime(this.gain.gain.value, now); 
       
      // 3. Linear ramp to 0 for cleanest sound 
      this.gain.gain.linearRampToValueAtTime(0, now + fadeOutDuration); 

      // 4. Schedule source stop after fade out ends 
      try { 
        this.source.stop(now + fadeOutDuration); 
      } catch (e) { 
        void e; 
      } 
       
      // Delay cleanup slightly to guarantee audio context has finished stopping 
      setTimeout(() => { 
        this.cleanup(); 
      }, (fadeOutDuration * 1000) + 200); 

    } else { 
      // Stop immediately 
      this.stopNode(); 
      this.cleanup(); 
    } 
  } 
  
  /** 
   * Set volume 
   */ 
  public setVolume(value: number, rampTime = 0.1) { 
    if (!this.gain) { 
      this._options.volume = value; // Update config if not playing 
      return; 
    } 
    const now = this.ctx.currentTime; 
    this.gain.gain.cancelScheduledValues(now); 
    this.gain.gain.setTargetAtTime(value, now, rampTime); 
    this._options.volume = value; 
  } 
  
  /** 
   * Seek playback progress 
   */ 
  public seek(time: number) { 
    const wasPlaying = this._isPlaying; 
    if (wasPlaying) { 
      this.stopNode(); 
    } 
    this._startOffset = time; 
    if (wasPlaying) { 
      this.start(); 
    } 
  } 
  
  // --- Internal Helpers --- 
  
  private stopNode() { 
    if (this.source) { 
      try { 
        this.source.stop(); 
      } catch (e) { 
        // Ignore errors if already stopped 
      } 
    } 
  } 
  
  private cleanup() { 
    this._isPlaying = false; 
    if (this.source) { 
      this.source.disconnect(); 
      this.source = null; 
    } 
    if (this.gain) { 
      this.gain.disconnect(); 
      this.gain = null; 
    } 
    if (this.onEnded) this.onEnded(); 
  } 
} 
  
// Export singleton 
export const audioKit = new WebAudioKit(); 
