/**
 * Light preset data module
 * 
 * Defines preset parameters for all light types (ambient / point / spot).
 * Shared between LightPickerDialog (selection on creation) and ObjectPropertiesPanel (one-click apply).
 */

/** Parameter set for point / spot light presets */
export interface LightPresetParams {
  lightColor: string
  lightIntensity: number
  lightRadius: number
  flicker: number
  flickerSpeed: number
  directionAngle?: number
  coneAngle?: number
}

/** Preset entry */
export interface LightPresetEntry {
  /** Unique identifier for matching and persistence */
  id: string
  /** UI display name */
  label: string
  /** Description text */
  description: string
  /** Preset parameters */
  params: LightPresetParams
}

// ─── Ambient Light Presets ──────────────────────────────────────────
export const AMBIENT_PRESETS: LightPresetEntry[] = [
  {
    id: 'daylight',
    label: 'Daylight',
    description: 'Bright natural sunlight',
    params: { lightColor: '#ffffff', lightIntensity: 1.0, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
  {
    id: 'overcast',
    label: 'Overcast',
    description: 'Soft grayish-blue light',
    params: { lightColor: '#c8d0db', lightIntensity: 0.75, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
  {
    id: 'twilight',
    label: 'Twilight',
    description: 'Warm orange sunset',
    params: { lightColor: '#e8a050', lightIntensity: 0.65, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
  {
    id: 'night',
    label: 'Night',
    description: 'Deep blue night sky',
    params: { lightColor: '#2a3a6a', lightIntensity: 0.30, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
  {
    id: 'candlelit',
    label: 'Candlelight',
    description: 'Warm yellow candle stand',
    params: { lightColor: '#d4956a', lightIntensity: 0.45, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
  {
    id: 'moonlight',
    label: 'Moonlight',
    description: 'Cool blue moonlight',
    params: { lightColor: '#8090c0', lightIntensity: 0.40, lightRadius: 500, flicker: 0, flickerSpeed: 0.35 },
  },
]

// ─── Point Light Presets (§10.2) ────────────────────────────────────
export const POINT_LIGHT_PRESETS: LightPresetEntry[] = [
  {
    id: 'bulb',
    label: 'Light Bulb',
    description: 'Steady warm white bulb',
    params: {
      lightColor: '#fff5e0',
      lightIntensity: 1.0,
      lightRadius: 350,
      flicker: 0,
      flickerSpeed: 0.35,
    },
  },
  {
    id: 'candle',
    label: 'Candle',
    description: 'Warm flickering flame',
    params: {
      lightColor: '#ff9940',
      lightIntensity: 0.75,
      lightRadius: 200,
      flicker: 0.35,
      flickerSpeed: 0.25,
    },
  },
  {
    id: 'torch',
    label: 'Torch',
    description: 'Warm orange blazing fire',
    params: {
      lightColor: '#ff6a20',
      lightIntensity: 1.1,
      lightRadius: 400,
      flicker: 0.55,
      flickerSpeed: 0.40,
    },
  },
  {
    id: 'glitch',
    label: 'Glitch Light',
    description: 'Fast irregular flickering',
    params: {
      lightColor: '#e0f0ff',
      lightIntensity: 0.9,
      lightRadius: 280,
      flicker: 0.70,
      flickerSpeed: 0.85,
    },
  },
  {
    id: 'magic',
    label: 'Magic Light',
    description: 'Cool blue pulsing magical glow',
    params: {
      lightColor: '#80c0ff',
      lightIntensity: 0.85,
      lightRadius: 320,
      flicker: 0.25,
      flickerSpeed: 0.18,
    },
  },
]

// ─── Spot Light Presets (§10.3) ────────────────────────────────────
export const SPOT_LIGHT_PRESETS: LightPresetEntry[] = [
  {
    id: 'flashlight',
    label: 'Flashlight',
    description: 'Narrow white beam spotlight',
    params: {
      lightColor: '#ffffff',
      lightIntensity: 1.1,
      lightRadius: 500,
      flicker: 0,
      flickerSpeed: 0.35,
      directionAngle: 0,
      coneAngle: 45,
    },
  },
  {
    id: 'spotlight',
    label: 'Stage Spotlight',
    description: 'Bright warm white follow spotlight',
    params: {
      lightColor: '#fffbe6',
      lightIntensity: 1.4,
      lightRadius: 600,
      flicker: 0,
      flickerSpeed: 0.35,
      directionAngle: 0,
      coneAngle: 60,
    },
  },
  {
    id: 'wallsconce',
    label: 'Wall Sconce',
    description: 'Semicircular warm wall lamp',
    params: {
      lightColor: '#ffe0b0',
      lightIntensity: 0.80,
      lightRadius: 280,
      flicker: 0.08,
      flickerSpeed: 0.15,
      directionAngle: 0,
      coneAngle: 160,
    },
  },
  {
    id: 'streetlamp',
    label: 'Street Lamp',
    description: 'Downward even street light',
    params: {
      lightColor: '#fff0d0',
      lightIntensity: 0.95,
      lightRadius: 450,
      flicker: 0,
      flickerSpeed: 0.35,
      directionAngle: Math.PI / 2,   // Downward
      coneAngle: 110,
    },
  },
]

/** Get presets list by light type */
export function getPresetsForLightType(lightType: 'ambient' | 'point' | 'spot'): LightPresetEntry[] {
  switch (lightType) {
    case 'ambient': return AMBIENT_PRESETS
    case 'point':   return POINT_LIGHT_PRESETS
    case 'spot':    return SPOT_LIGHT_PRESETS
  }
}
