/**
 * TC-SPD-RESOURCE-AUDIT: Scene Asset Usage and Preload Integrity Audit
 * 
 * Verification levels:
 * 1. Setup static assets - character initial state, props, backgrounds
 * 2. Block dynamic assets - set_character/set_expression dynamic switching
 * 3. Preload verification - whether all used assets are collected
 * 
 * This test suite validates ScenePreviewDialog asset preloading integrity
 */

import nodeFs from 'fs'
import nodePath from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { useAssetLoader } from '@/composables/useAssetLoader'
import { useBackgroundStore } from '@/stores/backgroundStore'

import { useEpisodeStore } from '@/stores/episodeStore'
import { useExpressionStore } from '@/stores/expressionStore'
import { useProjectStore } from '@/stores/projectStore'
import { usePropStore } from '@/stores/propStore'
import type { ScriptBlock } from '@/types/screenplay'

describe('TC-SPD-RESOURCE-AUDIT: Resource Usage and Preload Verification', () => {
    let projectStore: ReturnType<typeof useProjectStore>
    let hasProjectData = false

    let episodeStore: ReturnType<typeof useEpisodeStore>
    let expressionStore: ReturnType<typeof useExpressionStore>
    let backgroundStore: ReturnType<typeof useBackgroundStore>
    let propStore: ReturnType<typeof usePropStore>

    beforeAll(async () => {
        setActivePinia(createPinia())
        projectStore = useProjectStore()

        episodeStore = useEpisodeStore()
        expressionStore = useExpressionStore()
        backgroundStore = useBackgroundStore()
        propStore = usePropStore()

        const projectPath = nodePath.resolve(__dirname, '../../../examples/demo-project/demo.anime')
        if (nodeFs.existsSync(projectPath)) {
            const content = nodeFs.readFileSync(projectPath, 'utf-8')
            await projectStore.OnlyForAutoTestCase_OpenProject(content)
            hasProjectData = episodeStore.episodes.some(episode => episode.scenes?.length > 0)
        }
    })

    function ensureProjectData() {
        if (!hasProjectData) return false
        return true
    }

    /**
     * AUDIT-01: Setup Static Asset Inventory
     * Lists assets used by each object in Setup
     */
    it('AUDIT-01: Catalog all resources used in Scene Setup', () => {
        if (!ensureProjectData()) return
        const episode = episodeStore.episodes[0]
        if (!episode) throw new Error('Episode not found')
        expect(episode).toBeDefined()

        const scene = episode.scenes[0]
        if (!scene) throw new Error('Scene not found')
        expect(scene).toBeDefined()

        console.log('\n========== SETUP RESOURCE AUDIT ==========')

        const setupResources = {
            characters: [] as { id: string, name: string, pose: string, expression: string, imageCount: number }[],
            props: [] as { id: string, name: string, imageCount: number }[],
            backgrounds: [] as { id: string, name: string, hasImage: boolean }[],
            audio: [] as { id: string, refId: string }[]
        }

        for (const obj of scene.setup.objects) {
            if (obj.type === 'prop') {
                const propId = (obj as any).refId
                const prop = propStore.getProp(propId)
                if (!prop) continue

                let imageCount = 0
                if (prop.url) imageCount++
                imageCount += prop.frames?.length || 0

                setupResources.props.push({
                    id: obj.id,
                    name: prop.name || propId,
                    imageCount
                })
            } else if (obj.type === 'background') {
                const bg = backgroundStore.getBackground(obj.refId)
                if (!bg) continue

                setupResources.backgrounds.push({
                    id: obj.id,
                    name: bg.name || obj.refId,
                    hasImage: !!((bg as any).url || (bg as any).backgroundImage)
                })
            } else if (obj.type === 'audio') {
                setupResources.audio.push({
                    id: obj.id,
                    refId: obj.refId
                })
            }
        }

        // Output report
        console.log('\n--- Characters ---')
        setupResources.characters.forEach(c => {
            console.log(`  [${c.id.substring(0, 20)}...] ${c.name}: Pose=${c.pose}, Expr=${c.expression || 'none'}, Images=${c.imageCount}`)
        })

        console.log('\n--- Props ---')
        setupResources.props.forEach(p => {
            console.log(`  [${p.id.substring(0, 20)}...] ${p.name}: ${p.imageCount} images`)
        })

        console.log('\n--- Backgrounds ---')
        setupResources.backgrounds.forEach(b => {
            console.log(`  [${b.id.substring(0, 20)}...] ${b.name}: ${b.hasImage ? '✓' : '✗'} image`)
        })

        console.log('\n--- Audio ---')
        setupResources.audio.forEach(a => {
            console.log(`  [${a.id.substring(0, 20)}...] refId=${a.refId}`)
        })

        // Verify
        const totalObjects = setupResources.characters.length +
            setupResources.props.length +
            setupResources.backgrounds.length +
            setupResources.audio.length
        console.log(`\nTotal Setup Objects: ${totalObjects}`)
        expect(totalObjects).toBeGreaterThan(0)
    })

    /**
     * AUDIT-02: Block Dynamic Asset Inventory
     * Analyzes additional assets referenced by Actions in each Block
     */
    it('AUDIT-02: Catalog all resources used in Block Actions', () => {
        if (!ensureProjectData()) return
        const episode = episodeStore.episodes[0]
        if (!episode) throw new Error('Episode not found')
        const scene = episode.scenes[0]
        if (!scene) throw new Error('Scene not found')

        console.log('\n========== BLOCK ACTION RESOURCE AUDIT ==========')

        interface DynamicResource {
            actionType: string
            target: string
            pose?: string
            expression?: string
            additionalImages: number
        }

        interface BlockResource {
            blockId: string
            blockIndex: number
            blockType: string
            dynamicResources: DynamicResource[]
        }

        const blockResources: BlockResource[] = []

        scene.script.forEach((block: any, index: number) => {
            const dynamicResources: DynamicResource[] = []

            if (block.actions) {
                for (const action of block.actions) {
                    if (action.type === 'set_transform') {
                        let additionalImages = 0
                        const params = action.params || {}

                        // Expression switch
                        if (params.expression) {
                            const expr = expressionStore.getExpression(params.expression)
                            if (expr?.defaultFrame?.url) additionalImages++
                            additionalImages += expr?.speakingFrames?.length || 0
                        }

                        dynamicResources.push({
                            actionType: action.type,
                            target: action.target,
                            pose: params.pose,
                            expression: params.expression,
                            additionalImages
                        })
                    }
                }
            }

            blockResources.push({
                blockId: block.id,
                blockIndex: index,
                blockType: block.type,
                dynamicResources
            })
        })

        // Output report
        let totalDynamicActions = 0
        let totalAdditionalImages = 0

        blockResources.forEach(br => {
            if (br.dynamicResources.length > 0) {
                console.log(`\nBlock ${br.blockIndex} [${br.blockType}] (${br.blockId.substring(0, 20)}...):`)
                br.dynamicResources.forEach(dr => {
                    console.log(`  [${dr.actionType}] target=${dr.target.substring(0, 15)}...`)
                    if (dr.pose) console.log(`    → pose: ${dr.pose}`)
                    if (dr.expression) console.log(`    → expression: ${dr.expression}`)
                    console.log(`    → additional images: ${dr.additionalImages}`)
                    totalAdditionalImages += dr.additionalImages
                })
                totalDynamicActions += br.dynamicResources.length
            }
        })

        console.log(`\n========================================`)
        console.log(`Total Blocks: ${blockResources.length}`)
        console.log(`Total Dynamic Actions (set_character): ${totalDynamicActions}`)
        console.log(`Total Additional Images from Actions: ${totalAdditionalImages}`)

        // Information gathering test, verifies basic structure only
        expect(blockResources.length).toBe(scene.script.length)
    })

    /**
     * AUDIT-03: Preload Integrity Verification
     * Compares assets collected by collectAssets with actually used assets
     * 
     * Validates whether current ScenePreviewDialog preload strategy is complete
     */
    it('AUDIT-03: Verify preload completeness (setup-only vs full scan)', () => {
        if (!ensureProjectData()) return
        const episode = episodeStore.episodes[0]
        if (!episode) throw new Error('Episode not found')
        const scene = episode.scenes[0]
        if (!scene) throw new Error('Scene not found')

        console.log('\n========== PRELOAD COMPLETENESS VERIFICATION ==========')

        const { collectAssets } = useAssetLoader()

        // 1. Pass setup only (current ScenePreviewDialog practice)
        const { imageUrls: setupOnlyUrls } = collectAssets(scene.setup, null)
        console.log(`\n[Strategy 1] Setup only: ${setupOnlyUrls.size} images collected`)

        // 2. Pass setup + each block (full scan)
        const allBlockUrls = new Set<string>()
        scene.script.forEach((block: ScriptBlock) => {
            const { imageUrls } = collectAssets(scene.setup, block)
            imageUrls.forEach(url => allBlockUrls.add(url))
        })
        console.log(`[Strategy 2] Setup + all blocks: ${allBlockUrls.size} images collected`)

        // 3. Compare diff
        const missingInSetupOnly = new Set<string>()
        allBlockUrls.forEach(url => {
            if (!setupOnlyUrls.has(url)) {
                missingInSetupOnly.add(url)
            }
        })

        if (missingInSetupOnly.size > 0) {
            console.log(`\n⚠️  MISSING ${missingInSetupOnly.size} images when only scanning setup:`)
            let count = 0
            missingInSetupOnly.forEach(url => {
                if (count < 5) { // Show first 5 only
                    console.log(`  - ${url.substring(0, 60)}...`)
                }
                count++
            })
            if (count > 5) {
                console.log(`  ... and ${count - 5} more`)
            }

            // If missing, this requires attention
            console.log(`\n💡 RECOMMENDATION: ScenePreviewDialog should scan all blocks for complete preloading`)
        } else {
            console.log(`\n✅ All resources covered by setup-only scan`)
            console.log(`   (This means all dynamic resources are already covered by character state traversal)`)
        }

        // Verify basic functionality works normally
        expect(setupOnlyUrls.size).toBeGreaterThan(0)

        // Record coverage rate
        const coverageRate = allBlockUrls.size > 0
            ? ((allBlockUrls.size - missingInSetupOnly.size) / allBlockUrls.size * 100).toFixed(1)
            : '100'
        console.log(`\nPreload Coverage Rate: ${coverageRate}%`)
    })

    /**
     * AUDIT-04: Complete Preload Scene Asset Collection
     * Demonstrates recommended full asset collection method
     */
    it('AUDIT-04: Full scene resource collection (recommended approach)', () => {
        if (!ensureProjectData()) return
        const episode = episodeStore.episodes[0]
        if (!episode) throw new Error('Episode not found')
        const scene = episode.scenes[0]
        if (!scene) throw new Error('Scene not found')

        const { collectAssets } = useAssetLoader()

        // Recommended: traverse all Blocks to collect assets
        const fullImageUrls = new Set<string>()
        const fullAudioUrls = new Set<string>()

        // Step 1: Setup
        const { imageUrls: setupImages, audioUrls: setupAudio } = collectAssets(scene.setup, null)
        setupImages.forEach(url => fullImageUrls.add(url))
        setupAudio.forEach(url => fullAudioUrls.add(url))

        // Step 2: All Blocks
        scene.script.forEach((block: ScriptBlock) => {
            const { imageUrls, audioUrls } = collectAssets(scene.setup, block)
            imageUrls.forEach(url => fullImageUrls.add(url))
            audioUrls.forEach(url => fullAudioUrls.add(url))
        })

        console.log('\n========== RECOMMENDED PRELOAD STRATEGY ==========')
        console.log(`Total unique images: ${fullImageUrls.size}`)
        console.log(`Total unique audio: ${fullAudioUrls.size}`)
        console.log(`Total blocks scanned: ${scene.script.length}`)

        // Verify complete collection results
        expect(fullImageUrls.size).toBeGreaterThanOrEqual(setupImages.size)
    })

    /**
     * AUDIT-05: Expression Asset Coverage Verification
     * Specifically verifies expression asset collection (for V7 data structure)
     */
    it('AUDIT-05: Expression resource coverage verification', () => {
        if (!ensureProjectData()) return
        const episode = episodeStore.episodes[0]
        if (!episode) throw new Error('Episode not found')
        const scene = episode.scenes[0]
        if (!scene) throw new Error('Scene not found')

        console.log('\n========== EXPRESSION RESOURCE AUDIT ==========')

        // Collect all potentially used expression IDs
        const usedExpressionIds = new Set<string>()

        // 1. Expressions in Setup
        // character type removed, Setup no longer collects object expressions

        // 2. Expressions in Block Actions
        for (const block of scene.script) {
            if ((block as any).actions) {
                for (const action of (block as any).actions) {
                    if (action.type === 'set_transform' && action.params?.expression) {
                        usedExpressionIds.add(action.params.expression)
                    }
                }
            }
        }

        console.log(`\nTotal expressions referenced: ${usedExpressionIds.size}`)

        // Verify each expression can be resolved
        let resolvableCount = 0
        let unresolvableCount = 0

        usedExpressionIds.forEach(exprId => {
            const expr = expressionStore.getExpression(exprId)
            if (expr?.defaultFrame?.url) {
                resolvableCount++
                console.log(`  ✓ ${exprId}: ${expr.name || 'unnamed'}`)
            } else {
                unresolvableCount++
                console.log(`  ✗ ${exprId}: NOT FOUND in expressionStore`)
            }
        })

        console.log(`\nResolvable: ${resolvableCount}, Unresolvable: ${unresolvableCount}`)

        // Verify: all referenced expressions should resolve
        if (usedExpressionIds.size > 0) {
            expect(unresolvableCount).toBe(0)
        }
    })
})
