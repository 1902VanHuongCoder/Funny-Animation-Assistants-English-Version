import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => {
    class Filter {
        public uniforms: Record<string, unknown>

        constructor(_vertex?: string, _fragment?: string, uniforms?: Record<string, unknown>) {
            this.uniforms = uniforms ?? {}
        }
    }

    return { Filter }
})

import { PetrifyFilter } from '../PetrifyFilter'

describe('PetrifyFilter', () => {
    it('should instantiate correctly', () => {
        const filter = new PetrifyFilter()
        expect(filter).toBeDefined()
        expect(filter.progress).toBe(0)
        expect(filter.intensity).toBe(1)
        expect(filter.seed).toBeDefined()
    })

    it('should update progress', () => {
        const filter = new PetrifyFilter()
        filter.progress = 0.5
        expect(filter.progress).toBe(0.5)
        expect(filter.uniforms['uProgress']).toBe(0.5)
    })

    it('should update intensity', () => {
        const filter = new PetrifyFilter()
        filter.intensity = 0.8
        expect(filter.intensity).toBe(0.8)
        expect(filter.uniforms['uIntensity']).toBe(0.8)
    })

    it('should update seed', () => {
        const filter = new PetrifyFilter()
        const newSeed = 12345
        filter.seed = newSeed
        expect(filter.seed).toBe(newSeed)
        expect(filter.uniforms['uSeed']).toBe(newSeed)
    })
})
