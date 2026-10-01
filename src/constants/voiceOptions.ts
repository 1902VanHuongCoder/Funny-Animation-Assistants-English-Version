/**
 * TTS voice metadata module
 *
 * This module manages voice metadata and utility functions for optional TTS Providers.
 * All components requiring voice lists should import from this module rather than hardcoding.
 *
 * Community Edition does not connect to cloud vendor services by default. The provider
 * identifiers and voice IDs are preserved for local compatibility, self-hosted services, or third-party adapters.
 */

/** TTS Provider metadata identifier. */
export type VoiceProviderId = 'tencent' | 'baidu'

/** @deprecated Use VoiceProviderId for new code. */
export type TTSEngine = VoiceProviderId

/**
 * Voice option interface
 */
export interface VoiceOption {
    /** Voice ID (interpreted by specific Provider adapter) */
    id: number
    /** Display name */
    name: string
    /** Gender */
    gender: 'male' | 'female'
    /** Voice description tag */
    description: string
    /** Owning Provider metadata identifier */
    engine: VoiceProviderId
}

/**
 * Available voice metadata list.
 */
export const VOICE_OPTIONS: VoiceOption[] = [
    // ================================================================
    // Tencent-compatible provider metadata (48 voices)
    // See: examples/tts-provider/README.md
    // ================================================================

    // --- Ultra-Natural LLM ---
    { id: 502001, name: 'Zhi Xiaorou', gender: 'female', description: 'Gentle & Warm', engine: 'tencent' },
    { id: 502003, name: 'Zhi Xiaomin', gender: 'female', description: 'Vibrant Female', engine: 'tencent' },
    { id: 502004, name: 'Zhi Xiaoman', gender: 'female', description: 'Customer Support Female', engine: 'tencent' },
    { id: 502005, name: 'Zhi Xiaojie', gender: 'male', description: 'Commentary Male', engine: 'tencent' },
    { id: 502006, name: 'Zhi Xiaowu', gender: 'male', description: 'Sunny Male', engine: 'tencent' },
    { id: 502007, name: 'Zhi Xiaohu', gender: 'male', description: 'Dramatic Child', engine: 'tencent' },
    { id: 602003, name: 'Ai Xiaoyou', gender: 'female', description: 'Emotional', engine: 'tencent' },
    { id: 602004, name: 'Ah Can', gender: 'male', description: 'Calm & Majestic', engine: 'tencent' },
    { id: 602005, name: 'Zi Xin', gender: 'female', description: 'Energetic & Friendly', engine: 'tencent' },
    { id: 603000, name: 'Sensible Youth', gender: 'male', description: 'Sensible Youth', engine: 'tencent' },
    { id: 603001, name: 'Xiaoxiang Sister', gender: 'female', description: 'Playful Female', engine: 'tencent' },
    { id: 603002, name: 'Xin Xin', gender: 'male', description: 'Playful Child', engine: 'tencent' },
    { id: 603003, name: 'Old Li', gender: 'male', description: 'Easygoing & Composed', engine: 'tencent' },
    { id: 603004, name: 'Xiao Ning', gender: 'female', description: 'Gentle & Warm', engine: 'tencent' },
    { id: 603005, name: 'Da Lin', gender: 'male', description: 'Mature Magnetic', engine: 'tencent' },
    { id: 603006, name: 'Uncle Qing', gender: 'male', description: 'Calm Magnetic', engine: 'tencent' },
    { id: 603007, name: 'Neighbor Girl', gender: 'female', description: 'Warm & Natural', engine: 'tencent' },

    // --- Large Model ---
    { id: 501000, name: 'Zhibin', gender: 'male', description: 'Magnetic Male', engine: 'tencent' },
    { id: 501001, name: 'Zhilan', gender: 'female', description: 'Lively Female', engine: 'tencent' },
    { id: 501002, name: 'Zhiju', gender: 'female', description: 'Graceful & Elegant', engine: 'tencent' },
    { id: 501003, name: 'Zhiyu', gender: 'male', description: 'Mature Uncle', engine: 'tencent' },
    { id: 501004, name: 'Yuehua', gender: 'female', description: 'Clever & Refined', engine: 'tencent' },
    { id: 501005, name: 'Feijing', gender: 'male', description: 'Gentle Male', engine: 'tencent' },
    { id: 501006, name: 'Qianzhang', gender: 'male', description: 'Calm & Majestic', engine: 'tencent' },
    { id: 501007, name: 'Qiancao', gender: 'male', description: 'Youthful Male', engine: 'tencent' },
    { id: 501008, name: 'WeJames', gender: 'male', description: 'Foreign Male', engine: 'tencent' },
    { id: 501009, name: 'WeWinny', gender: 'female', description: 'Foreign Female', engine: 'tencent' },
    { id: 601008, name: 'Ai Xiaohao', gender: 'male', description: 'Dominant & Cool', engine: 'tencent' },
    { id: 601009, name: 'Ai Xiaoqian', gender: 'female', description: 'Pure & Agile', engine: 'tencent' },
    { id: 601010, name: 'Ai Xiaojiao', gender: 'female', description: 'Charming Female', engine: 'tencent' },
    { id: 601011, name: 'Ai Xiaochuan', gender: 'male', description: 'Energetic Youth', engine: 'tencent' },
    { id: 601012, name: 'Ai Xiaojing', gender: 'female', description: 'Cute Little Girl', engine: 'tencent' },
    { id: 601013, name: 'Ai Xiaoyi', gender: 'female', description: 'Intellectual Sister', engine: 'tencent' },
    { id: 601014, name: 'Ai Xiaojian', gender: 'male', description: 'Fresh Student', engine: 'tencent' },

    // --- Premium ---
    { id: 101001, name: 'Zhiyu (Female)', gender: 'female', description: 'Elegant Sister', engine: 'tencent' },
    { id: 101004, name: 'Zhiyun', gender: 'male', description: 'Reading Male', engine: 'tencent' },
    { id: 101011, name: 'Zhiyan', gender: 'female', description: 'Authoritative Broadcaster Female', engine: 'tencent' },
    { id: 101013, name: 'Zhihui', gender: 'male', description: 'News Anchor', engine: 'tencent' },
    { id: 101015, name: 'Zhimeng', gender: 'male', description: 'Innocent Child', engine: 'tencent' },
    { id: 101016, name: 'Zhitian', gender: 'female', description: 'Cute Baby', engine: 'tencent' },
    { id: 101019, name: 'Zhitong', gender: 'female', description: 'Fashionable Cantonese Sister', engine: 'tencent' },
    { id: 101021, name: 'Zhirui', gender: 'male', description: 'News Anchor', engine: 'tencent' },
    { id: 101026, name: 'Zhixi', gender: 'female', description: 'Sweet Assistant', engine: 'tencent' },
    { id: 101027, name: 'Zhimei', gender: 'female', description: 'Soft & Generous', engine: 'tencent' },
    { id: 101030, name: 'Zhike', gender: 'male', description: 'Natural & Lively', engine: 'tencent' },
    { id: 101054, name: 'Zhiyou', gender: 'male', description: 'Commentary Guy', engine: 'tencent' },
    { id: 101055, name: 'Zhifu', gender: 'female', description: 'Smart Cashier', engine: 'tencent' },

    // ================================================================
    // Baidu-compatible provider metadata (76 voices)
    // See: examples/tts-provider/README.md
    // ================================================================

    // --- Basic Voice Library ---
    { id: 0, name: 'Du Xiaomei', gender: 'female', description: 'Standard Hostess', engine: 'baidu' },
    { id: 1, name: 'Du Xiaoyu', gender: 'male', description: 'Friendly Male', engine: 'baidu' },
    { id: 3, name: 'Du Xiaoyao', gender: 'male', description: 'Emotional Male', engine: 'baidu' },
    { id: 4, name: 'Du Yaya', gender: 'female', description: 'Child Voice', engine: 'baidu' },

    // --- Premium Voice Library ---
    { id: 5003, name: 'Du Xiaoyao', gender: 'male', description: 'Emotional Male', engine: 'baidu' },
    { id: 5118, name: 'Du Xiaolu', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 106, name: 'Du Bowen', gender: 'male', description: 'Professional Host', engine: 'baidu' },
    { id: 103, name: 'Du Miduo', gender: 'female', description: 'Cute Child', engine: 'baidu' },
    { id: 110, name: 'Du Xiaotong', gender: 'male', description: 'Child Host', engine: 'baidu' },
    { id: 111, name: 'Du Xiaomeng', gender: 'female', description: 'Soft Sweet Girl', engine: 'baidu' },
    { id: 5, name: 'Du Xiaojiao', gender: 'female', description: 'Mature Hostess', engine: 'baidu' },

    // --- Luxury Voice Library ---
    { id: 4003, name: 'Du Xiaoyao', gender: 'male', description: 'Emotional Male', engine: 'baidu' },
    { id: 4106, name: 'Du Bowen', gender: 'male', description: 'Professional Host', engine: 'baidu' },
    { id: 4115, name: 'Du Xiaoxian', gender: 'male', description: 'Radio Host', engine: 'baidu' },
    { id: 5147, name: 'Du Changying', gender: 'female', description: 'Radio Hostess', engine: 'baidu' },
    { id: 5976, name: 'Du Xiaopi', gender: 'male', description: 'Cute Toddler', engine: 'baidu' },
    { id: 5971, name: 'Du Peter', gender: 'male', description: 'Foreigner Male', engine: 'baidu' },
    { id: 4164, name: 'Du Aken', gender: 'male', description: 'Host Male', engine: 'baidu' },
    { id: 4176, name: 'Du Youwei', gender: 'male', description: 'Magnetic Male', engine: 'baidu' },
    { id: 4259, name: 'Du Xiaoxin', gender: 'female', description: 'Broadcast Female', engine: 'baidu' },
    { id: 4119, name: 'Du Xiaolu', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 4105, name: 'Du Linger', gender: 'female', description: 'Clear Female', engine: 'baidu' },
    { id: 4117, name: 'Du Xiaoqiao', gender: 'female', description: 'Lively Female', engine: 'baidu' },
    { id: 4288, name: 'Du Qinglan', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 4192, name: 'Du Qingchuan', gender: 'male', description: 'Gentle Male', engine: 'baidu' },
    { id: 4100, name: 'Du Xiaowen', gender: 'female', description: 'Energetic Hostess', engine: 'baidu' },
    { id: 4103, name: 'Du Miduo', gender: 'female', description: 'Cute Female', engine: 'baidu' },
    { id: 4144, name: 'Du Shanshan', gender: 'female', description: 'Entertainment Female', engine: 'baidu' },
    { id: 4278, name: 'Du Xiaobei', gender: 'female', description: 'Educational Hostess', engine: 'baidu' },
    { id: 4143, name: 'Du Qingfeng', gender: 'male', description: 'Dubbing Male', engine: 'baidu' },
    { id: 4140, name: 'Du Xiaoxin', gender: 'female', description: 'Professional Hostess', engine: 'baidu' },
    { id: 4129, name: 'Du Xiaoyan', gender: 'male', description: 'Educational Host', engine: 'baidu' },
    { id: 4149, name: 'Du Xinghe', gender: 'male', description: 'Commercial Male', engine: 'baidu' },
    { id: 4254, name: 'Du Xiaoqing', gender: 'female', description: 'Commercial Female', engine: 'baidu' },
    { id: 4206, name: 'Du Bowen', gender: 'male', description: 'Variety Show Male', engine: 'baidu' },
    { id: 4147, name: 'Du Yunduo', gender: 'female', description: 'Cute Child', engine: 'baidu' },
    { id: 4141, name: 'Du Wanwan', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 4226, name: 'Nanfang', gender: 'female', description: 'Radio Hostess', engine: 'baidu' },
    { id: 6205, name: 'Du Youran', gender: 'male', description: 'Narrator Male', engine: 'baidu' },
    { id: 6221, name: 'Du Yunxuan', gender: 'female', description: 'Narrator Female', engine: 'baidu' },
    { id: 6546, name: 'Du Qinghao', gender: 'male', description: 'Carefree Knight', engine: 'baidu' },
    { id: 6602, name: 'Du Qingrou', gender: 'male', description: 'Gentle Idol', engine: 'baidu' },
    { id: 6562, name: 'Du Yu\'nan', gender: 'female', description: 'Energetic Girl', engine: 'baidu' },
    { id: 6543, name: 'Du Yumeng', gender: 'female', description: 'Neighbor Girl', engine: 'baidu' },
    { id: 6747, name: 'Du Shugu', gender: 'male', description: 'Emotional Male', engine: 'baidu' },
    { id: 6748, name: 'Du Shuyan', gender: 'male', description: 'Composed Male', engine: 'baidu' },
    { id: 6746, name: 'Du Shudao', gender: 'male', description: 'Composed Male', engine: 'baidu' },
    { id: 6644, name: 'Du Shuning', gender: 'female', description: 'Affable Female', engine: 'baidu' },
    { id: 4148, name: 'Du Xiaoxia', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 4277, name: 'Xi Bei', gender: 'female', description: 'Talk Show Female', engine: 'baidu' },
    { id: 4114, name: 'Ah Long', gender: 'male', description: 'Storyteller Male', engine: 'baidu' },
    { id: 5153, name: 'Du Changyue', gender: 'female', description: 'News Reporter Female', engine: 'baidu' },
    { id: 6561, name: 'Du Xiaole', gender: 'male', description: 'Cute Child', engine: 'baidu' },

    // --- LLM Voice Library ---
    { id: 4179, name: 'Du Zeyan', gender: 'male', description: 'Warm Male', engine: 'baidu' },
    { id: 4146, name: 'Du Xixi', gender: 'female', description: 'Sunny Female', engine: 'baidu' },
    { id: 6567, name: 'Du Xiaorou', gender: 'female', description: 'Gentle Female', engine: 'baidu' },
    { id: 4156, name: 'Du Yanhao', gender: 'male', description: 'Young Male', engine: 'baidu' },
    { id: 4157, name: 'Du Yanjing', gender: 'female', description: 'Bright Female', engine: 'baidu' },
    { id: 4189, name: 'Du Hanzhu', gender: 'female', description: 'Cheerful Female', engine: 'baidu' },
    { id: 4194, name: 'Du Yanran', gender: 'female', description: 'Lively Female', engine: 'baidu' },
    { id: 4193, name: 'Du Zeyan', gender: 'male', description: 'Cheerful Male', engine: 'baidu' },
    { id: 4195, name: 'Du Huai\'an', gender: 'male', description: 'Magnetic Male', engine: 'baidu' },
    { id: 4196, name: 'Du Qingying', gender: 'female', description: 'Sweet Female', engine: 'baidu' },
    { id: 4197, name: 'Du Qinyao', gender: 'female', description: 'Intellectual Female', engine: 'baidu' },
    { id: 20100, name: 'Du Xiaoyue', gender: 'female', description: 'Cantonese Female', engine: 'baidu' },
    { id: 20101, name: 'Du Xiaoyun', gender: 'female', description: 'Cantonese Female', engine: 'baidu' },
    { id: 4257, name: 'Sichuan Guy', gender: 'male', description: 'Sichuan Male', engine: 'baidu' },
    { id: 4132, name: 'Du A\'min', gender: 'male', description: 'Minnan Male', engine: 'baidu' },
    { id: 4139, name: 'Du Xiaorong', gender: 'female', description: 'Sichuan Female', engine: 'baidu' },
    { id: 5977, name: 'Taiwan Media Female', gender: 'female', description: 'Taiwanese Female', engine: 'baidu' },
    { id: 4007, name: 'Du Xiaotai', gender: 'female', description: 'Taiwanese Female', engine: 'baidu' },
    { id: 4150, name: 'Du Xiangyu', gender: 'female', description: 'Shaanxi Female', engine: 'baidu' },
    { id: 4134, name: 'Du A\'jin', gender: 'female', description: 'Northeast Female', engine: 'baidu' },
    { id: 4172, name: 'Du Xiaolin', gender: 'female', description: 'Tianjin Female', engine: 'baidu' },
    { id: 5980, name: 'Du A\'hua', gender: 'female', description: 'Shanghai Female', engine: 'baidu' },
    { id: 4154, name: 'Du Lao Cui', gender: 'male', description: 'Beijing Male', engine: 'baidu' },
]

/**
 * Default voice ID (by gender)
 */
export const DEFAULT_VOICE_ID = {
    female: 101026,
    male: 101030,
    other: 101026,   // Default female voice
} as const

/**
 * General default voice (as fallback value)
 */
export const FALLBACK_VOICE_ID = 101026 // Zhixi

// ==================== Utility Functions ====================

/**
 * Get all voice options
 */
export function getVoiceOptions(): VoiceOption[] {
    return VOICE_OPTIONS
}

/**
 * Get voice option by ID
 */
export function getVoiceById(id: number | string | undefined): VoiceOption | undefined {
    if (id === undefined) return undefined
    const numId = typeof id === 'string' ? parseInt(id, 10) : id
    return VOICE_OPTIONS.find(v => v.id === numId)
}

/**
 * Get voice display name by ID
 */
export function getVoiceName(id: number | string | undefined): string {
    if (id === undefined) return 'Not set'
    const voice = getVoiceById(id)
    if (!voice) {
        return `Voice ${id}`
    }
    const genderLabel = voice.gender === 'female' ? 'Female' : 'Male'
    return `${voice.name} (${genderLabel})`
}

/**
 * Get default voice ID by gender
 */
export function getDefaultVoiceIdByGender(gender: string): number {
    if (gender === 'female') {
        return DEFAULT_VOICE_ID.female
    }
    if (gender === 'male') {
        return DEFAULT_VOICE_ID.male
    }
    return DEFAULT_VOICE_ID.other
}

/**
 * Get female voice list
 */
export function getFemaleVoices(): VoiceOption[] {
    return VOICE_OPTIONS.filter(v => v.gender === 'female')
}

/**
 * Get male voice list
 */
export function getMaleVoices(): VoiceOption[] {
    return VOICE_OPTIONS.filter(v => v.gender === 'male')
}

/**
 * Get owning Provider metadata identifier by voice ID.
 */
export function getVoiceEngine(id: number | string | undefined): VoiceProviderId {
    if (id === undefined) return 'tencent'
    const voice = getVoiceById(id)
    return voice?.engine ?? 'tencent'
}

const TENCENT_ULTRA_NATURAL = new Set([
    502001, 502003, 502004, 502005, 502006, 502007,
    602003, 602004, 602005,
    603000, 603001, 603002, 603003, 603004, 603005, 603006, 603007,
])

const TENCENT_LLM = new Set([
    501000, 501001, 501002, 501003, 501004, 501005, 501006, 501007, 501008, 501009,
    601008, 601009, 601010, 601011, 601012, 601013, 601014,
])

const BAIDU_BASIC = new Set([0, 1, 3, 4])
const BAIDU_PREMIUM = new Set([5003, 5118, 106, 103, 110, 111, 5])
const BAIDU_LLM = new Set([
    4179, 4146, 6567, 4156, 4157, 4189, 4194, 4193, 4195, 4196, 4197,
    20100, 20101, 4257, 4132, 4139, 5977, 4007, 4150, 4134, 4172, 5980, 4154,
])

/**
 * Get voice cost weight hint.
 *
 * Used only for UI hints for optional TTS Providers; does not represent built-in billing
 * nor imply default connection to cloud services.
 */
export function getVoiceCostWeight(voice: Pick<VoiceOption, 'engine' | 'id'>): number {
    if (voice.engine === 'baidu') {
        if (BAIDU_BASIC.has(voice.id)) return 2.67
        if (BAIDU_PREMIUM.has(voice.id)) return 5.33
        if (BAIDU_LLM.has(voice.id)) return 6
        return 6
    }

    if (TENCENT_ULTRA_NATURAL.has(voice.id)) return 21.67
    if (TENCENT_LLM.has(voice.id)) return 4
    return 1
}

/**
 * Get cost tier for voice card display.
 */
export function getVoiceCostTier(voice: Pick<VoiceOption, 'engine' | 'id'>): number {
    return Math.ceil(getVoiceCostWeight(voice))
}

export function getVoiceCostTierLabel(voice: Pick<VoiceOption, 'engine' | 'id'>): string {
    return `Tier ${getVoiceCostTier(voice)}`
}

// ========== Speech Speed Settings ==========

/**
 * Speech speed option interface
 */
export interface SpeedOption {
    /** General speech speed parameter value, compatible with legacy range (-2 ~ 6) */
    value: number
    /** Display label */
    label: string
    /** Short description */
    description: string
}

/**
 * Speech speed option list (semantic labels).
 * Specific Providers can map to their own speech speed ranges in adapters.
 */
export const SPEED_OPTIONS: SpeedOption[] = [
    { value: -2, label: 'Slower', description: 'Approx 0.67x speed' },
    { value: -1, label: 'Slow', description: 'Approx 0.83x speed' },
    { value: 0, label: 'Normal', description: '1.0x speed' },
    { value: 2, label: 'Fast', description: 'Approx 1.33x speed' },
    { value: 4, label: 'Faster', description: 'Approx 1.67x speed' },
    { value: 6, label: 'Very Fast', description: 'Approx 2.0x speed' },
]

/**
 * Default speech speed value (Normal)
 */
export const DEFAULT_SPEED = 0

/**
 * Default volume value (neutral TTS volume)
 */
export const DEFAULT_VOLUME = 0

/**
 * Get all speech speed options
 */
export function getSpeedOptions(): SpeedOption[] {
    return SPEED_OPTIONS
}

/**
 * Get speech speed label by TTS parameter value
 */
export function getSpeedLabel(value: number): string {
    const option = SPEED_OPTIONS.find(o => o.value === value)
    return option?.label ?? 'Normal'
}

/**
 * Convert legacy speed value (0.5 ~ 2.0) to new TTS parameter value
 * Used for data migration
 */
export function convertLegacySpeedToTTSValue(legacySpeed: number): number {
    if (legacySpeed <= 0.7) return -2
    if (legacySpeed <= 0.9) return -1
    if (legacySpeed <= 1.1) return 0
    if (legacySpeed <= 1.4) return 2
    if (legacySpeed <= 1.8) return 4
    return 6
}

/**
 * Check if value is legacy speed format (0.5 ~ 2.0)
 * New format uses standard values: -2, -1, 0, 2, 4, 6
 */
export function isLegacySpeedFormat(speed: number): boolean {
    const validNewValues = [-2, -1, 0, 2, 4, 6]
    return speed > 0 && speed <= 2.5 && !validNewValues.includes(speed)
}

/**
 * Intelligently get TTS speech speed value
 * Automatically handles legacy format conversion
 */
export function getValidSpeedValue(speed: number | undefined): number {
    if (speed === undefined) return DEFAULT_SPEED

    // Detect and convert legacy format (non-standard values within 0.5-2.0)
    if (isLegacySpeedFormat(speed)) {
        return convertLegacySpeedToTTSValue(speed)
    }

    // Ensure value is within valid range
    if (speed < -2) return -2
    if (speed > 6) return 6

    return speed
}

/**
 * Intelligently get local playback volume parameter value.
 *
 * Volume is not sent to TTS provider, but used as gain in frontend playback/export mixing.
 */
export function getValidVolumeValue(volume: number | undefined): number {
    if (volume === undefined) return DEFAULT_VOLUME

    const rounded = Math.round(volume)
    if (rounded < -10) return -10
    if (rounded > 10) return 10
    return rounded
}

/**
 * Map user volume (-10 ~ 10) to local playback gain.
 * 0 is unity gain, 10 is approx 10x gain, -10 is approx 1/10 volume.
 */
export function getPlaybackVolumeGain(volume: number | undefined): number {
    const normalized = getValidVolumeValue(volume)
    return Math.pow(10, normalized / 10)
}

export function getPlaybackVolumePercent(volume: number | undefined): number {
    return Math.round(getPlaybackVolumeGain(volume) * 100)
}
