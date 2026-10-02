/**
 * Pluggable TTS Provider client.
 *
 * Open-source edition does not connect to any private cloud services by default. When speech synthesis is needed,
 * connect local models, self-hosted services, or third-party adapters explicitly via
 * registerTTSProvider / configureLocalHttpTTSProvider.
 */

import type { TTSEngine } from '@/constants/voiceOptions'
import { getVoiceOptions } from '@/constants/voiceOptions'

export interface TTSRequest {
  text: string
  engine?: TTSEngine
  voiceType?: number
  volume?: number
  speed?: number
  codec?: 'mp3' | 'wav' | 'pcm'
  sampleRate?: 16000 | 8000
}

export interface TTSResponse {
  audio: string
  audioBase64?: string
  duration?: number
  cached?: boolean
  providerId?: string
}

export interface VoiceInfo {
  id: number
  name: string
  gender: 'male' | 'female'
  language: string
  description: string
  providerId?: string
}

export interface TTSProvider {
  id: string
  label: string
  description?: string
  synthesize(request: TTSRequest): Promise<TTSResponse>
  preview?(request: TTSRequest): Promise<TTSResponse>
  estimateDuration?(text: string, speed?: number): Promise<number>
  getVoices?(): Promise<VoiceInfo[]>
  clearCache?(): void
  getCacheSize?(): number
}

export interface LocalHttpTTSProviderConfig {
  baseUrl: string
  synthesizeEndpoint?: string
  previewEndpoint?: string
  voicesEndpoint?: string
  headers?: Record<string, string>
}

interface LocalHttpTTSPayload {
  audio?: string
  audioUrl?: string
  audioBase64?: string
  duration?: number
  cached?: boolean
}

const DEFAULT_PROVIDER_ID = 'manual'
const LOCAL_HTTP_PROVIDER_ID = 'local-http'
export const LOCAL_HTTP_TTS_CONFIG_STORAGE_KEY = 'funny-animation-assistant.tts.local-http'

export class TTSProviderNotConfiguredError extends Error {
  readonly errorCode = 'TTS_PROVIDER_NOT_CONFIGURED'

  constructor() {
    super('Local TTS Provider is not configured. Please import local audio for the dialogue first, or connect a local voice service in Phase 2 TTS Provider.')
    this.name = 'TTSProviderNotConfiguredError'
  }
}

export class TTSProviderNotFoundError extends Error {
  readonly errorCode = 'TTS_PROVIDER_NOT_FOUND'

  constructor(providerId: string) {
    super(`TTS Provider not found: ${providerId}`)
    this.name = 'TTSProviderNotFoundError'
  }
}

export class TTSProviderRegistry {
  private readonly providers = new Map<string, TTSProvider>()

  register(provider: TTSProvider): void {
    if (!provider.id.trim()) {
      throw new Error('TTS Provider id cannot be empty')
    }
    this.providers.set(provider.id, provider)
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId)
  }

  get(providerId: string): TTSProvider | undefined {
    return this.providers.get(providerId)
  }

  list(): TTSProvider[] {
    return [...this.providers.values()]
  }

  clear(): void {
    this.providers.clear()
  }
}

export class TTSClient {
  private activeProviderId = DEFAULT_PROVIDER_ID

  constructor(private readonly registry: TTSProviderRegistry) {}

  setActiveProvider(providerId: string): void {
    if (!this.registry.get(providerId)) {
      throw new TTSProviderNotFoundError(providerId)
    }
    this.activeProviderId = providerId
  }

  getActiveProviderId(): string {
    return this.activeProviderId
  }

  getActiveProvider(): TTSProvider {
    const provider = this.registry.get(this.activeProviderId)
    if (!provider) {
      throw new TTSProviderNotFoundError(this.activeProviderId)
    }
    return provider
  }

  listProviders(): TTSProvider[] {
    return this.registry.list()
  }

  registerProvider(provider: TTSProvider, options: { activate?: boolean } = {}): void {
    this.registry.register(provider)
    if (options.activate) {
      this.activeProviderId = provider.id
    }
  }

  synthesize(request: TTSRequest): Promise<TTSResponse> {
    return this.withProviderId(this.getActiveProvider().synthesize(request))
  }

  preview(request: TTSRequest): Promise<TTSResponse> {
    const provider = this.getActiveProvider()
    if (provider.preview) {
      return this.withProviderId(provider.preview(request))
    }
    return this.withProviderId(provider.synthesize(request))
  }

  async batchSynthesize(requests: TTSRequest[]): Promise<TTSResponse[]> {
    return Promise.all(requests.map(request => this.synthesize(request)))
  }

  async estimateDuration(text: string, speed = 0): Promise<number> {
    const provider = this.getActiveProvider()
    if (provider.estimateDuration) {
      return provider.estimateDuration(text, speed)
    }
    return estimateDurationLocally(text, speed)
  }

  getVoices(): Promise<VoiceInfo[]> {
    const provider = this.getActiveProvider()
    return provider.getVoices ? provider.getVoices() : Promise.resolve([])
  }

  clearCache(): void {
    this.getActiveProvider().clearCache?.()
  }

  getCacheSize(): number {
    return this.getActiveProvider().getCacheSize?.() ?? 0
  }

  private async withProviderId(responsePromise: Promise<TTSResponse>): Promise<TTSResponse> {
    const response = await responsePromise
    if (response.providerId) return response
    return {
      ...response,
      providerId: this.activeProviderId,
    }
  }
}

export function estimateDurationLocally(text: string, speed = 0): number {
  const cleanedText = text.replace(/#/g, '').trim()
  if (!cleanedText) return 0

  const charsPerSecond = Math.max(2.5, 4 + speed)
  return Math.ceil((cleanedText.length / charsPerSecond) * 1000)
}

export function createManualTTSProvider(): TTSProvider {
  return {
    id: DEFAULT_PROVIDER_ID,
    label: 'Manual Audio Import',
    description: 'Default Provider, does not automatically synthesize speech; please import local audio for dialogue.',
    synthesize: () => Promise.reject(new TTSProviderNotConfiguredError()),
    preview: () => Promise.reject(new TTSProviderNotConfiguredError()),
    estimateDuration: (text, speed) => Promise.resolve(estimateDurationLocally(text, speed)),
    getVoices: () => Promise.resolve(toVoiceInfos(DEFAULT_PROVIDER_ID)),
    getCacheSize: () => 0,
  }
}

export function createLocalHttpTTSProvider(config: LocalHttpTTSProviderConfig): TTSProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const synthesizeEndpoint = config.synthesizeEndpoint ?? '/synthesize'
  const previewEndpoint = config.previewEndpoint ?? synthesizeEndpoint
  const voicesEndpoint = config.voicesEndpoint ?? '/voices'

  async function post(endpoint: string, request: TTSRequest): Promise<TTSResponse> {
    const res = await fetch(`${baseUrl}${normalizeEndpoint(endpoint)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
      },
      body: JSON.stringify(request),
    })

    if (!res.ok) {
      throw new Error(`Local TTS Provider request failed: HTTP ${res.status}`)
    }

    const payload = await res.json() as LocalHttpTTSPayload
    return normalizeLocalHttpResponse(payload)
  }

  return {
    id: LOCAL_HTTP_PROVIDER_ID,
    label: 'Local HTTP TTS',
    description: 'Synthesize speech via local or self-hosted HTTP service.',
    synthesize: request => post(synthesizeEndpoint, request),
    preview: request => post(previewEndpoint, request),
    estimateDuration: (text, speed) => Promise.resolve(estimateDurationLocally(text, speed)),
    getVoices: async () => {
      const init: RequestInit = { method: 'GET' }
      if (config.headers) {
        init.headers = config.headers
      }

      const res = await fetch(`${baseUrl}${normalizeEndpoint(voicesEndpoint)}`, init)
      if (!res.ok) return toVoiceInfos(LOCAL_HTTP_PROVIDER_ID)
      return await res.json() as VoiceInfo[]
    },
  }
}

export function registerTTSProvider(provider: TTSProvider, options?: { activate?: boolean }): void {
  ttsClient.registerProvider(provider, options)
}

export function configureLocalHttpTTSProvider(
  config: LocalHttpTTSProviderConfig,
  options: { activate?: boolean; persist?: boolean } = {}
): void {
  const provider = createLocalHttpTTSProvider(config)
  ttsClient.registerProvider(provider, { activate: options.activate ?? true })

  if (options.persist) {
    saveLocalHttpProviderConfig(config)
  }
}

function createDefaultRegistry(): TTSProviderRegistry {
  const registry = new TTSProviderRegistry()
  registry.register(createManualTTSProvider())
  return registry
}

function bootstrapConfiguredProvider(client: TTSClient): void {
  const env = (import.meta as unknown as {
    env?: {
      VITE_TTS_PROVIDER_URL?: string
      VITE_TTS_SYNTHESIZE_ENDPOINT?: string
      VITE_TTS_PREVIEW_ENDPOINT?: string
      VITE_TTS_VOICES_ENDPOINT?: string
    }
  }).env
  const envBaseUrl = env?.VITE_TTS_PROVIDER_URL
  if (envBaseUrl) {
    const config: LocalHttpTTSProviderConfig = { baseUrl: envBaseUrl }
    if (env?.VITE_TTS_SYNTHESIZE_ENDPOINT) {
      config.synthesizeEndpoint = env.VITE_TTS_SYNTHESIZE_ENDPOINT
    }
    if (env?.VITE_TTS_PREVIEW_ENDPOINT) {
      config.previewEndpoint = env.VITE_TTS_PREVIEW_ENDPOINT
    }
    if (env?.VITE_TTS_VOICES_ENDPOINT) {
      config.voicesEndpoint = env.VITE_TTS_VOICES_ENDPOINT
    }

    client.registerProvider(
      createLocalHttpTTSProvider(config),
      { activate: true }
    )
    return
  }

  const savedConfig = loadLocalHttpProviderConfig()
  if (savedConfig) {
    client.registerProvider(createLocalHttpTTSProvider(savedConfig), { activate: true })
  }
}

function normalizeLocalHttpResponse(payload: LocalHttpTTSPayload): TTSResponse {
  const audio = payload.audio ?? payload.audioUrl
  const audioBase64 = payload.audioBase64 ?? (audio ? extractBase64FromDataUrl(audio) : undefined)
  const audioUrl = audio ?? (audioBase64 ? toAudioDataUrl(audioBase64) : '')

  if (!audioUrl) {
    throw new Error('Local TTS Provider response missing audio or audioBase64')
  }

  const response: TTSResponse = { audio: audioUrl }
  if (audioBase64) response.audioBase64 = audioBase64
  if (payload.duration !== undefined) response.duration = payload.duration
  if (payload.cached !== undefined) response.cached = payload.cached
  return response
}

function toAudioDataUrl(audioBase64: string, mimeType = 'audio/mpeg'): string {
  return `data:${mimeType};base64,${audioBase64}`
}

function extractBase64FromDataUrl(audio: string): string | undefined {
  const match = /^data:[^;]+;base64,(.+)$/u.exec(audio)
  return match?.[1]
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '')
  if (!trimmed) {
    throw new Error('Local TTS Provider baseUrl cannot be empty')
  }
  return trimmed
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`
}

function toVoiceInfos(providerId: string): VoiceInfo[] {
  return getVoiceOptions().map(voice => ({
    id: voice.id,
    name: voice.name,
    gender: voice.gender,
    language: 'zh-CN',
    description: voice.description,
    providerId,
  }))
}

function loadLocalHttpProviderConfig(): LocalHttpTTSProviderConfig | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LOCAL_HTTP_TTS_CONFIG_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as LocalHttpTTSProviderConfig
    if (!parsed.baseUrl) return null
    return parsed
  } catch {
    return null
  }
}

function saveLocalHttpProviderConfig(config: LocalHttpTTSProviderConfig): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_HTTP_TTS_CONFIG_STORAGE_KEY, JSON.stringify(config))
}

export const ttsProviderRegistry = createDefaultRegistry()
export const ttsClient = new TTSClient(ttsProviderRegistry)

bootstrapConfiguredProvider(ttsClient)
