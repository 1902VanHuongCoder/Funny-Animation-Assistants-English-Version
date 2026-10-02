/**
 * LightingFilter — GPU Global Lighting Filter
 *
 * Custom fragment shader based on PIXI.Filter, applying ambient light + point light effects to the scene.
 * Supports up to MAX_LIGHTS point lights, each with independent position, color, intensity, and radius.
 *
 * v25.6: UV space coordinate system (fixes nested filter offset issue)
 * - CPU side normalizes light coordinates to output frame local UV space (0..1)
 * - Shader side restores true UV sampling range in input texture via outputFrame/inputSize
 * - Distance calculation still restores to pixel scale via vInputSize to ensure correct attenuation/radius
 * - Completely bypasses PIXI v7 FilterSystem frame-to-frame drift of filterArea.zw
 *   caused by internal modifications to outputFrame.xy when handling nested filters (GlowFilter)
 *
 * Core formula (recovery + additive glow hybrid model):
 *   ① ambientBase = originalColor * ambientLight (dark field darkening)
 *   ② recovered  = mix(ambientBase, originalColor, recover) (texture-aware recovery)
 *   ③ glow       = Σ(lightColor * geometricAttenuation) * glowStrength (texture-independent additive glow)
 *   ④ finalColor = recovered + glow
 *
 * The glow term ensures the light pool shape is determined by pure geometric attenuation,
 * independent of underlying texture color/brightness.
 */
import * as PIXI from 'pixi.js'

const MAX_LIGHTS = 8

export interface LightSourceData {
  x: number       // Output frame local UV space (0..1)
  y: number       // Output frame local UV space (0..1)
  radius: number  // Output frame local UV space (normalized relative to outputFrame.height)
  color: [number, number, number]  // RGB 0~1
  intensity: number
  // Phase 3: Directionality
  directionMode: number       // 0=omni, 1=cone
  directionAngle: number      // Heading angle (radians)
  coneHalfCos: number         // cos(coneAngle/2 * PI/180), precomputed on CPU
  softness: number            // Edge softness band width (fixed 0.35)
}

export interface AmbientLightData {
  color: [number, number, number]  // RGB 0~1
  intensity: number
}

const LIGHTING_FRAGMENT_SHADER = `
  precision mediump float;
  
  varying vec2 vTextureCoord;
  varying vec2 vInputSize;
  varying vec2 vTextureCoordScale;
  varying vec2 vOutputFrameSize;
  uniform sampler2D uSampler;
  uniform vec4 filterArea;
  
  #define MAX_LIGHTS 8
  uniform float uLightPosX[MAX_LIGHTS];
  uniform float uLightPosY[MAX_LIGHTS];
  uniform float uLightColorR[MAX_LIGHTS];
  uniform float uLightColorG[MAX_LIGHTS];
  uniform float uLightColorB[MAX_LIGHTS];
  uniform float uLightRadius[MAX_LIGHTS];
  uniform float uLightIntensity[MAX_LIGHTS];
  uniform int uLightCount;
  // Phase 3: Directionality uniforms
  uniform int uLightDirMode[MAX_LIGHTS];
  uniform float uLightDirAngle[MAX_LIGHTS];
  uniform float uLightConeHalfCos[MAX_LIGHTS];
  uniform float uLightSoftness[MAX_LIGHTS];
  
  uniform vec3 uAmbientColor;
  uniform float uAmbientIntensity;
  uniform float uLightRecoverStrength;
  uniform float uLightTintStrength;
  uniform float uLightGlowStrength;
  uniform float uLightInnerRatio;
  uniform float uLightTintLumaInfluence;
  uniform float uLightCoreBias;
  uniform sampler2D uExemptMask;
  uniform int uHasExemptMask;
  
  void main(void) {
    vec4 color = texture2D(uSampler, vTextureCoord);
    if (color.a < 0.01) {
      gl_FragColor = color;
      return;
    }

    float exemptAlpha = 0.0;
    if (uHasExemptMask == 1) {
      // exempt mask is rendered based on the complete local area of filterArea / outputFrame,
      // and cannot be sampled directly using input texture UV (vTextureCoord).
      // In ScenePlayer, vTextureCoordScale is often close to 1, so the issue is not obvious;
      // however in FrameCapture offscreen pipeline vTextureCoordScale can be significantly less than 1,
      // and direct sampling would sample the mask in the wrong area, causing the mask of receiveLighting=false objects to shift.
      vec2 exemptUv = vec2(
        vTextureCoordScale.x > 0.0 ? vTextureCoord.x / vTextureCoordScale.x : 0.0,
        vTextureCoordScale.y > 0.0 ? vTextureCoord.y / vTextureCoordScale.y : 0.0
      );
      exemptAlpha = texture2D(uExemptMask, exemptUv).a;
    }

    // Ambient dark field: first darken scene with ambient light, then locally recover original image brightness with point lights.
    // This allows the visual center of bright areas to be determined by the light field itself, rather than pulled by background textures.
    vec3 ambientBase = color.rgb * uAmbientColor * uAmbientIntensity;
    float totalRecoverLight = 0.0;
    vec3 totalGlowTint = vec3(0.0);
    vec3 totalSurfaceTint = vec3(0.0);
    
    // v25.6: UV space distance calculation (bypasses PIXI filterArea.zw offset drift)
    // CPU side passes "output frame local UV" (0..1).
    // Shader multiplies by vTextureCoordScale to project into the true UV space of the current input texture,
    // so whether the input texture is 720P / 1080P / 2K / 4K, it shares the same reference frame as vTextureCoord.
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      
      vec2 uvPos = vTextureCoord;
      vec2 uvLight = vec2(uLightPosX[i], uLightPosY[i]) * vTextureCoordScale;
      vec3 lightColor = vec3(uLightColorR[i], uLightColorG[i], uLightColorB[i]);
      
      // UV space delta, multiplied by vInputSize to restore to pixel distance
      vec2 delta = (uvPos - uvLight) * vInputSize;
      float dist = length(delta);
      // Radius restored from output frame local UV to output frame pixels, on the same pixel scale as delta
      float radius = uLightRadius[i] * vOutputFrameSize.y;
      
      // Soft light attenuation
      float innerRadius = radius * uLightInnerRatio;
      float attenuation = 1.0 - smoothstep(innerRadius, radius, dist);

      // Phase 3: Directional attenuation (cone mode only)
      if (uLightDirMode[i] == 1 && dist > 0.001) {
        vec2 dir = normalize(delta);
        vec2 forward = vec2(cos(uLightDirAngle[i]), sin(uLightDirAngle[i]));
        float angleCos = dot(dir, forward);
        float coneCos = uLightConeHalfCos[i];
        float softBand = uLightSoftness[i] * (1.0 - coneCos);
        float angularMask = smoothstep(coneCos - softBand, coneCos, angleCos);
        attenuation *= angularMask;
      }

      float contribution = uLightIntensity[i] * attenuation;
      totalRecoverLight += contribution;
      totalGlowTint += lightColor * contribution;
      totalSurfaceTint += lightColor * contribution;
    }

    float recover = clamp(totalRecoverLight * uLightRecoverStrength, 0.0, 1.0);
    float coreRecover = pow(recover, 0.75);
    recover = mix(recover, coreRecover, uLightCoreBias);
    vec3 recovered = mix(ambientBase, color.rgb, recover);

    vec3 glow = totalGlowTint * uLightGlowStrength;

    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float tintMask = mix(1.0, 1.0 - luminance, uLightTintLumaInfluence);
    vec3 tint = totalSurfaceTint * uLightTintStrength * tintMask;

    vec3 litResult = clamp(recovered + glow + tint, 0.0, 1.5);
    vec3 result = mix(litResult, color.rgb, clamp(exemptAlpha, 0.0, 1.0));

    gl_FragColor = vec4(result, color.a);
  }
`

const LIGHTING_VERTEX_SHADER = `
  attribute vec2 aVertexPosition;

  uniform mat3 projectionMatrix;
  uniform vec4 inputSize;
  uniform vec4 outputFrame;

  varying vec2 vTextureCoord;
  varying vec2 vInputSize;
  varying vec2 vTextureCoordScale;
  varying vec2 vOutputFrameSize;

  vec4 filterVertexPosition(void)
  {
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.0)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void)
  {
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
  }

  void main(void)
  {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vInputSize = inputSize.xy;
    vTextureCoordScale = outputFrame.zw * inputSize.zw;
    vOutputFrameSize = outputFrame.zw;
  }
`

export class LightingFilter extends PIXI.Filter {
  // Pre-allocated TypedArray instance members to avoid per-frame GC
  private readonly _posX = new Float32Array(MAX_LIGHTS)
  private readonly _posY = new Float32Array(MAX_LIGHTS)
  private readonly _colorR = new Float32Array(MAX_LIGHTS)
  private readonly _colorG = new Float32Array(MAX_LIGHTS)
  private readonly _colorB = new Float32Array(MAX_LIGHTS)
  private readonly _radius = new Float32Array(MAX_LIGHTS)
  private readonly _intensity = new Float32Array(MAX_LIGHTS)
  private readonly _dirMode = new Int32Array(MAX_LIGHTS)
  private readonly _dirAngle = new Float32Array(MAX_LIGHTS)
  private readonly _coneHalfCos = new Float32Array(MAX_LIGHTS)
  private readonly _softness = new Float32Array(MAX_LIGHTS)
  constructor() {
    super(LIGHTING_VERTEX_SHADER, LIGHTING_FRAGMENT_SHADER, {
      uLightPosX: new Float32Array(MAX_LIGHTS),
      uLightPosY: new Float32Array(MAX_LIGHTS),
      uLightColorR: new Float32Array(MAX_LIGHTS),
      uLightColorG: new Float32Array(MAX_LIGHTS),
      uLightColorB: new Float32Array(MAX_LIGHTS),
      uLightRadius: new Float32Array(MAX_LIGHTS),
      uLightIntensity: new Float32Array(MAX_LIGHTS),
      uLightCount: 0,
      // Phase 3: Directionality uniforms initialization
      uLightDirMode: new Int32Array(MAX_LIGHTS),
      uLightDirAngle: new Float32Array(MAX_LIGHTS),
      uLightConeHalfCos: new Float32Array(MAX_LIGHTS),
      uLightSoftness: new Float32Array(MAX_LIGHTS),
      uAmbientColor: [1.0, 1.0, 1.0],
      uAmbientIntensity: 1.0,  // Default full bright = no lighting effect
      uLightRecoverStrength: 1.0,
      uLightTintStrength: 0.08,
      uLightGlowStrength: 0.18,
      uLightInnerRatio: 0.45,
      uLightTintLumaInfluence: 0.2,
      uLightCoreBias: 0.35,
      uExemptMask: PIXI.Texture.EMPTY,
      uHasExemptMask: 0,
    })
    ;(this as PIXI.Filter & { legacy?: boolean }).legacy = true
    // v25.5: Must use autoFit=false + padding=0.
    // When autoFit=true, PIXI v7's FilterSystem fine-tunes outputFrame offsets internally
    // based on container hierarchy worldTransform and nested filter bounds (e.g. GlowFilter on child objects),
    // causing filterArea.zw (outputFrame.xy) in shader to drift frame-to-frame,
    // shifting light screenPos calculation -> light visual circle shakes following floating animated objects.
    // filterArea is explicitly set by caller (accurately covering canvas/viewport area), no PIXI adjustment needed.
    this.autoFit = false
    this.padding = 0
  }

  /**
   * Update shader uniforms from aggregated light source data
   */
  updateFromSceneObjects(
    lights: LightSourceData[],
    ambient: AmbientLightData,
  ): void {
    // Ambient light
    this.uniforms['uAmbientColor'] = ambient.color
    this.uniforms['uAmbientIntensity'] = ambient.intensity

    // Point lights — using filter/screen pixel space
    const count = Math.min(lights.length, MAX_LIGHTS)
    // Reuse pre-allocated TypedArray (avoid per-frame GC)
    const posX = this._posX; posX.fill(0)
    const posY = this._posY; posY.fill(0)
    const colorR = this._colorR; colorR.fill(0)
    const colorG = this._colorG; colorG.fill(0)
    const colorB = this._colorB; colorB.fill(0)
    const radius = this._radius; radius.fill(0)
    const intensity = this._intensity; intensity.fill(0)
    const dirMode = this._dirMode; dirMode.fill(0)
    const dirAngle = this._dirAngle; dirAngle.fill(0)
    const coneHalfCos = this._coneHalfCos; coneHalfCos.fill(0)
    const softness = this._softness; softness.fill(0)

    for (let i = 0; i < count; i++) {
      const l = lights[i]!
      posX[i] = l.x
      posY[i] = l.y
      colorR[i] = l.color[0]
      colorG[i] = l.color[1]
      colorB[i] = l.color[2]
      radius[i] = l.radius
      intensity[i] = l.intensity
      // Phase 3: Directionality
      dirMode[i] = l.directionMode
      dirAngle[i] = l.directionAngle
      coneHalfCos[i] = l.coneHalfCos
      softness[i] = l.softness
    }
    this.uniforms['uLightPosX'] = posX
    this.uniforms['uLightPosY'] = posY
    this.uniforms['uLightColorR'] = colorR
    this.uniforms['uLightColorG'] = colorG
    this.uniforms['uLightColorB'] = colorB
    this.uniforms['uLightRadius'] = radius
    this.uniforms['uLightIntensity'] = intensity
    this.uniforms['uLightCount'] = count
    // Phase 3: Directionality uniforms
    this.uniforms['uLightDirMode'] = dirMode
    this.uniforms['uLightDirAngle'] = dirAngle
    this.uniforms['uLightConeHalfCos'] = coneHalfCos
    this.uniforms['uLightSoftness'] = softness
  }

  setExemptMask(mask: PIXI.RenderTexture | null): void {
    this.uniforms['uExemptMask'] = mask ?? PIXI.Texture.EMPTY
    this.uniforms['uHasExemptMask'] = mask ? 1 : 0
  }

  /** Check if default state (full bright white, no point lights) — filter does not need to be attached */
  isNoop(): boolean {
    const ambientColor = this.uniforms['uAmbientColor'] as number[] | undefined
    const isWhiteAmbient = ambientColor
      ? (ambientColor[0]! >= 0.99 && ambientColor[1]! >= 0.99 && ambientColor[2]! >= 0.99)
      : true
    return isWhiteAmbient
      && (this.uniforms['uAmbientIntensity'] as number) >= 1.0
      && (this.uniforms['uLightCount'] as number) === 0
  }
}

/**
 * Convert hex color string to RGB 0~1 array
 * @param hex '#rrggbb' format
 * @returns [r, g, b] with each component in 0~1
 */
export function hexToRgbArray(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return [r, g, b]
}
