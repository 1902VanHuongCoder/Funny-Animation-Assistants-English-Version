/**
 * Animation Player (v11.0)
 * Animation player responsible for parsing AnimationDefinition and driving playback
 */

import type {
    AnimationDefinition,
    AnimationOutput,
    AnimationPlayParams,
    AnimationPlayState,
} from '@/types/animation'

import { AnimationTrackEvaluator, AUTO_DURATION_MARKER, mergeTrackOutputs } from './AnimationTrackEvaluator'

/**
 * Animation player instance
 */
export class AnimationPlayer {
    /** Currently playing Animation definition */
    private definition: AnimationDefinition | null = null

    /** Playback state */
    private _state: AnimationPlayState = 'stopped'

    /** Normalized progress (0-1) */
    private _progress = 0

    /** Playback speed */
    private _speed = 1.0

    /** Whether to loop */
    private _loop = false

    /** Total Animation duration (ms) */
    private _duration = 0

    /** v12.x: Runtime injected duration for Auto Duration (ms) */
    private _runtimeDuration: number | undefined = undefined

    /** Update callback */
    private onUpdateCallback: ((output: AnimationOutput) => void) | null = null

    /** v11.2: Stop callback (used for restoring still frame etc.) */
    private onStopCallback: ((definition: AnimationDefinition) => void) | null = null

    /** v11.5: Loop callback */
    private onLoopCallback: ((definition: AnimationDefinition) => void) | null = null



    /**
     * Constructor
     * @param onUpdate Optional update callback
     */
    constructor(onUpdate?: (output: AnimationOutput) => void) {
        if (onUpdate) {
            this.onUpdateCallback = onUpdate
        }
    }

    // ===== Public Accessors =====

    get state(): AnimationPlayState {
        return this._state
    }

    get progress(): number {
        return this._progress
    }

    get speed(): number {
        return this._speed
    }

    get loop(): boolean {
        return this._loop
    }

    get duration(): number {
        return this._duration
    }

    get isPlaying(): boolean {
        return this._state === 'playing'
    }

    get isPaused(): boolean {
        return this._state === 'paused'
    }

    get isFilled(): boolean {
        return this._state === 'filled'
    }

    get isStopped(): boolean {
        return this._state === 'stopped'
    }

    get currentAnimation(): AnimationDefinition | null {
        return this.definition
    }

    // ===== Control Methods =====

    /**
     * Play Animation
     * @param definition Animation definition
     * @param params Optional playback parameters
     */
    play(
        definition: AnimationDefinition,
        params?: AnimationPlayParams,
    ): void {
        this.definition = definition

        // v12.x: Store runtimeDuration for Auto Duration resolution
        this._runtimeDuration = params?.runtimeDuration
        this._duration = this.calculateDuration(definition)

        // Apply playback parameters
        this._speed = params?.speed ?? 1.0
        this._loop = params?.loop ?? definition.loop

        // Whether to start from the beginning
        if (params?.reset !== false) {
            this._progress = 0
        }

        this._state = 'playing'
    }

    /**
     * Stop playback
     * v11.2: Triggers onStop callback on stop
     */
    stop(): void {
        if (this.onStopCallback && this.definition && this._state !== 'filled') {
            this.onStopCallback(this.definition)
        }

        this._state = 'stopped'
        this._progress = 0
    }

    /**
     * Pause playback
     */
    pause(): void {
        if (this._state === 'playing') {
            this._state = 'paused'
        }
    }

    /**
     * Resume playback
     */
    resume(): void {
        if (this._state === 'paused') {
            this._state = 'playing'
        }
    }

    /**
     * Set update callback
     */
    setOnUpdate(callback: (output: AnimationOutput) => void): void {
        this.onUpdateCallback = callback
    }

    /**
     * v11.2: Set stop callback
     * Callback triggers when animation stops, useful for restoring still frames etc.
     */
    setOnStop(callback: (definition: AnimationDefinition) => void): void {
        this.onStopCallback = callback
    }

    /**
     * v11.5: Set loop callback
     */
    setOnLoop(callback: (definition: AnimationDefinition) => void): void {
        this.onLoopCallback = callback
    }

    /**
     * Seek to specified progress
     * @param progress Normalized progress (0-1)
     */
    seek(progress: number): void {
        this._progress = Math.max(0, Math.min(1, progress))
    }

    /**
     * Set playback speed
     */
    setSpeed(speed: number): void {
        this._speed = Math.max(0.1, Math.min(10, speed))
    }

    /**
     * Set whether to loop
     */
    setLoop(loop: boolean): void {
        this._loop = loop
    }

    // ===== Update Methods =====

    /**
     * Per-frame update
     * Called by render loop
     * @param deltaTime Time elapsed since previous frame (ms)
     * @returns Output state of current frame
     */
    update(deltaTime: number): AnimationOutput | null {
        if (!this.definition) {
            return null
        }

        if (this._state === 'filled') {
            const output = this.evaluate(1)
            if (this.onUpdateCallback) {
                this.onUpdateCallback(output)
            }
            return output
        }

        if (this._state !== 'playing') {
            return null
        }

        // Update progress
        if (this._duration > 0) {
            const progressDelta = (deltaTime * this._speed) / this._duration
            this._progress += progressDelta

            // Handle playback completion
            if (this._progress >= 1) {
                if (this._loop) {
                    this._progress = this._progress % 1

                    // v11.5: Trigger loop callback
                    if (this.onLoopCallback && this.definition) {
                        this.onLoopCallback(this.definition)
                    }
                } else {
                    this._progress = 1
                    const fillMode = this.definition.type === 'track'
                        ? this.definition.fillMode ?? 'none'
                        : 'none'
                    this._state = fillMode === 'forwards' ? 'filled' : 'stopped'
                    if (this.onStopCallback && this.definition) {
                        this.onStopCallback(this.definition)
                    }
                }
            }
        }

        // Calculate output
        const output = this.evaluate(this._progress)

        // Trigger callback
        if (this.onUpdateCallback) {
            this.onUpdateCallback(output)
        }

        return output
    }

    /**
     * Get output of current frame (without updating progress)
     */
    getCurrentOutput(): AnimationOutput | null {
        if (!this.definition) {
            return null
        }
        return this.evaluate(this._progress)
    }

    // ===== Private Methods =====

    /**
     * Calculate total Animation duration
     */
    private calculateDuration(definition: AnimationDefinition): number {
        if (definition.type !== 'track') return 1000
        let maxDuration = 0

        // Calculate track durations
        for (const track of definition.tracks) {
            const trackDuration = AnimationTrackEvaluator.getTrackDuration(track)
            // v12.x: AUTO_DURATION_MARKER replaced with runtimeDuration
            const resolvedDuration = trackDuration === AUTO_DURATION_MARKER
                ? (this._runtimeDuration ?? 1000)
                : trackDuration
            if (resolvedDuration !== Infinity && resolvedDuration > maxDuration) {
                maxDuration = resolvedDuration
            }
        }

        return maxDuration || 1000
    }

    /**
     * Evaluate all tracks at current progress
     * v11.2: Each track uses independent progress (based on track's own duration)
     */
    private evaluate(progress: number): AnimationOutput {
        if (!this.definition) {
            return {
                transforms: [],
                visibilities: [],
                effects: [],
            }
        }

        // v11.2: Current elapsed time (ms)
        const elapsedTime = progress * this._duration

        // Calculate main track outputs
        // v11.2: Each track uses independent progress
        // v11.52: Filter out frame_sequence tracks; frame animation directly uses AnimatedSprite.play()
        if (this.definition.type !== 'track') {
            return { transforms: [], visibilities: [], effects: [] }
        }
        const evaluableTracks = this.definition.tracks.filter(
            track => track.trackType !== 'frame_sequence'
        )
        const trackOutputs = evaluableTracks.map(track => {
            const rawTrackDuration = AnimationTrackEvaluator.getTrackDuration(track)
            // v12.x: AUTO_DURATION_MARKER replaced with runtimeDuration
            const trackDuration = rawTrackDuration === AUTO_DURATION_MARKER
                ? (this._runtimeDuration ?? 1000)
                : rawTrackDuration

            // Calculate track independent progress
            let trackProgress: number
            if (trackDuration === Infinity || trackDuration <= 0) {
                // Infinite or invalid duration, use global progress
                trackProgress = progress
            } else if (trackDuration >= this._duration) {
                // Track duration >= total duration, use global progress
                trackProgress = progress
            } else {
                // v11.2: Track duration < total duration
                if (this._loop) {
                    // When Animation loops, track also loops
                    trackProgress = (elapsedTime % trackDuration) / trackDuration
                } else {
                    // When Animation does not loop, track stays at final state after completion
                    trackProgress = Math.min(1, elapsedTime / trackDuration)
                }
            }

            // v11.70: Pass trackDuration for progress-driven effect calculation
            const effectiveDuration = trackDuration === Infinity ? this._duration : trackDuration
            return AnimationTrackEvaluator.evaluate(track, trackProgress, effectiveDuration)
        })

        return mergeTrackOutputs(trackOutputs)
    }


}

/**
 * Animation Player Manager
 * Used to manage multiple player instances
 */
export class AnimationPlayerManager {
    private players = new Map<string, AnimationPlayer>()

    /**
     * Get or create player
     */
    getOrCreate(id: string): AnimationPlayer {
        let player = this.players.get(id)
        if (!player) {
            player = new AnimationPlayer()
            this.players.set(id, player)
        }
        return player
    }

    /**
     * Get player
     */
    get(id: string): AnimationPlayer | undefined {
        return this.players.get(id)
    }

    /**
     * Remove player
     */
    remove(id: string): boolean {
        const player = this.players.get(id)
        if (player) {
            player.stop()
            this.players.delete(id)
            return true
        }
        return false
    }

    /**
     * Update all players
     */
    updateAll(deltaTime: number): Map<string, AnimationOutput | null> {
        const outputs = new Map<string, AnimationOutput | null>()
        for (const [id, player] of this.players) {
            outputs.set(id, player.update(deltaTime))
        }
        return outputs
    }

    /**
     * Stop all players
     */
    stopAll(): void {
        for (const player of this.players.values()) {
            player.stop()
        }
    }

    /**
     * Clear all players
     */
    clear(): void {
        this.stopAll()
        this.players.clear()
    }

    /**
     * Get all player IDs
     */
    getAllIds(): string[] {
        return Array.from(this.players.keys())
    }

    /**
     * Get number of currently playing players
     */
    getPlayingCount(): number {
        let count = 0
        for (const player of this.players.values()) {
            if (player.isPlaying) {
                count++
            }
        }
        return count
    }
}

/**
 * Create Animation player
 */
export function createAnimationPlayer(onUpdate?: (output: AnimationOutput) => void): AnimationPlayer {
    return new AnimationPlayer(onUpdate)
}

/**
 * Create Animation player manager
 */
export function createAnimationPlayerManager(): AnimationPlayerManager {
    return new AnimationPlayerManager()
}
