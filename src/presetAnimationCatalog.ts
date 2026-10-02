/**
 * System Preset Animation Template Library (v3 - Name Addressing)
 *
 * All templates uniformly use PresetAnimationTemplate + TargetTrackGroup structure.
 * Resolved to UUID by presetAnimationMapper based on alias/name during instantiation.
 */

import type { TransformTrack } from '@/types/animation'
import type { PresetAnimationTemplate } from '@/types/presetAnimation'
import { validatePresetTemplate } from '@/types/presetAnimation'

const deg = (value: number): number => (value * Math.PI) / 180

// ===== Helper Functions: Return bare TransformTrack (without outer animation wrapper) =====

function rotationTrack(
  frames: { time: number; rotation: number }[],
  duration = 1000,
  easing: TransformTrack['easing'] = 'linear',
): TransformTrack {
  return {
    trackType: 'transform',
    duration,
    easing,
    keyframes: frames.map(f => ({ time: f.time, rotation: f.rotation })),
  }
}

function yOffsetTrack(
  values: { time: number; y: number }[],
  duration = 1000,
  easing: TransformTrack['easing'] = 'linear',
): TransformTrack {
  return {
    trackType: 'transform',
    duration,
    easing,
    keyframes: values,
  }
}

// ===== Target key constants (used in this file only) =====

const K_BODY = 'body'
const K_LEFT_ARM = 'left_arm'
const K_LEFT_LOWER_ARM = 'left_lower_arm'
const K_RIGHT_ARM = 'right_arm'
const K_RIGHT_LOWER_ARM = 'right_lower_arm'
const K_LEFT_LEG = 'left_leg'
const K_LEFT_CALF = 'left_calf'
const K_RIGHT_LEG = 'right_leg'
const K_RIGHT_CALF = 'right_calf'

// ===== System Preset Animation Templates =====

export const PRESET_ANIMATIONS: PresetAnimationTemplate[] = [

  // --- Locomotion -------------------------------------------

  {
    id: 'preset_walk_cycle',
    name: 'Walk',
    description: 'Standard walk cycle, swinging limbs with gentle body bobbing',
    category: 'locomotion',
    tags: ['walk', 'cycle'],
    origin: 'system',
    expectedTargets: [
      { key: K_BODY, recommendedName: 'Body', fallbackNames: ['body'] },
      { key: K_LEFT_ARM, recommendedName: 'Left Arm', fallbackNames: ['left_arm'] },
      { key: K_RIGHT_ARM, recommendedName: 'Right Arm', fallbackNames: ['right_arm'] },
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 1000,
    targetTracks: [
      {
        targetKey: K_BODY,
        tracks: [yOffsetTrack([
          { time: 0, y: 0 },
          { time: 0.25, y: -2 },
          { time: 0.5, y: 0 },
          { time: 0.75, y: 2 },
          { time: 1, y: 0 },
        ])],
      },
      {
        targetKey: K_LEFT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-15) },
          { time: 0.5, rotation: deg(15) },
          { time: 1, rotation: deg(-15) },
        ])],
      },
      {
        targetKey: K_RIGHT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(15) },
          { time: 0.5, rotation: deg(-15) },
          { time: 1, rotation: deg(15) },
        ])],
      },
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(12) },
          { time: 0.5, rotation: deg(-12) },
          { time: 1, rotation: deg(12) },
        ])],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-12) },
          { time: 0.5, rotation: deg(12) },
          { time: 1, rotation: deg(-12) },
        ])],
      },
    ],
  },

  {
    id: 'preset_run_cycle',
    name: 'Run',
    description: 'High-energy run cycle with wide arm swings and high leg lifts',
    category: 'locomotion',
    tags: ['run', 'cycle'],
    origin: 'system',
    expectedTargets: [
      { key: K_BODY, recommendedName: 'Body', fallbackNames: ['body'] },
      { key: K_LEFT_ARM, recommendedName: 'Left Arm', fallbackNames: ['left_arm'] },
      { key: K_RIGHT_ARM, recommendedName: 'Right Arm', fallbackNames: ['right_arm'] },
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 600,
    targetTracks: [
      {
        targetKey: K_BODY,
        tracks: [yOffsetTrack([
          { time: 0, y: 0 },
          { time: 0.25, y: -8 },
          { time: 0.5, y: 0 },
          { time: 0.75, y: 6 },
          { time: 1, y: 0 },
        ], 600)],
      },
      {
        targetKey: K_LEFT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-40) },
          { time: 0.5, rotation: deg(40) },
          { time: 1, rotation: deg(-40) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(40) },
          { time: 0.5, rotation: deg(-40) },
          { time: 1, rotation: deg(40) },
        ], 600)],
      },
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(45) },
          { time: 0.5, rotation: deg(-45) },
          { time: 1, rotation: deg(45) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-45) },
          { time: 0.5, rotation: deg(45) },
          { time: 1, rotation: deg(-45) },
        ], 600)],
      },
    ],
  },

  {
    id: 'preset_walk_cycle_fine',
    name: 'Walk Detailed',
    description: 'Detailed walk cycle with full limb swings plus forearm and calf secondary motion',
    category: 'locomotion',
    tags: ['walk', 'cycle', 'fine'],
    origin: 'system',
    expectedTargets: [
      { key: K_BODY, recommendedName: 'Body', fallbackNames: ['body'] },
      { key: K_LEFT_ARM, recommendedName: 'Left Arm', fallbackNames: ['left_arm'] },
      { key: K_LEFT_LOWER_ARM, recommendedName: 'Left Lower Arm', fallbackNames: ['left_lower_arm', 'Left Forearm'] },
      { key: K_RIGHT_ARM, recommendedName: 'Right Arm', fallbackNames: ['right_arm'] },
      { key: K_RIGHT_LOWER_ARM, recommendedName: 'Right Lower Arm', fallbackNames: ['right_lower_arm', 'Right Forearm'] },
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_LEFT_CALF, recommendedName: 'Left Calf', fallbackNames: ['left_calf', 'Left Lower Leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
      { key: K_RIGHT_CALF, recommendedName: 'Right Calf', fallbackNames: ['right_calf', 'Right Lower Leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 1000,
    targetTracks: [
      {
        targetKey: K_BODY,
        tracks: [yOffsetTrack([
          { time: 0, y: 0 },
          { time: 0.25, y: -2 },
          { time: 0.5, y: 0 },
          { time: 0.75, y: 2 },
          { time: 1, y: 0 },
        ])],
      },
      {
        targetKey: K_LEFT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-15) },
          { time: 0.25, rotation: deg(-4) },
          { time: 0.5, rotation: deg(15) },
          { time: 0.75, rotation: deg(4) },
          { time: 1, rotation: deg(-15) },
        ])],
      },
      {
        // Left forearm: elbow flexes inward 10-30 deg; most bent when upper arm swings back (t=0), most extended when swinging forward (t=0.5)
        targetKey: K_LEFT_LOWER_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(30) },
          { time: 0.25, rotation: deg(15) },
          { time: 0.5, rotation: deg(10) },
          { time: 0.75, rotation: deg(20) },
          { time: 1, rotation: deg(30) },
        ])],
      },
      {
        targetKey: K_RIGHT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(15) },
          { time: 0.25, rotation: deg(4) },
          { time: 0.5, rotation: deg(-15) },
          { time: 0.75, rotation: deg(-4) },
          { time: 1, rotation: deg(15) },
        ])],
      },
      {
        // Right forearm: mirrored with left forearm + half-cycle offset; most bent to -30 deg when upper arm swings forward (t=0.5)
        targetKey: K_RIGHT_LOWER_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-10) },
          { time: 0.25, rotation: deg(-20) },
          { time: 0.5, rotation: deg(-30) },
          { time: 0.75, rotation: deg(-15) },
          { time: 1, rotation: deg(-10) },
        ])],
      },
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(12) },
          { time: 0.25, rotation: deg(4) },
          { time: 0.5, rotation: deg(-12) },
          { time: 0.75, rotation: deg(-4) },
          { time: 1, rotation: deg(12) },
        ])],
      },
      {
        // Left calf: support phase (t=0~0.25) straight 0 deg; swing phase knee bend, mid swing (t=0.75) most bent -25 deg
        targetKey: K_LEFT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(0) },
          { time: 0.25, rotation: deg(0) },
          { time: 0.5, rotation: deg(-10) },
          { time: 0.75, rotation: deg(-25) },
          { time: 1, rotation: deg(0) },
        ])],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-12) },
          { time: 0.25, rotation: deg(-4) },
          { time: 0.5, rotation: deg(12) },
          { time: 0.75, rotation: deg(4) },
          { time: 1, rotation: deg(-12) },
        ])],
      },
      {
        // Right calf: half-cycle offset - mid swing (t=0.25) most bent -25 deg, same sign as left calf
        targetKey: K_RIGHT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-10) },
          { time: 0.25, rotation: deg(-25) },
          { time: 0.5, rotation: deg(0) },
          { time: 0.75, rotation: deg(0) },
          { time: 1, rotation: deg(-10) },
        ])],
      },
    ],
  },

  {
    id: 'preset_run_cycle_fine',
    name: 'Run Detailed',
    description: 'Detailed run cycle with full limb swings plus forearm and calf speed motion',
    category: 'locomotion',
    tags: ['run', 'cycle', 'fine'],
    origin: 'system',
    expectedTargets: [
      { key: K_BODY, recommendedName: 'Body', fallbackNames: ['body'] },
      { key: K_LEFT_ARM, recommendedName: 'Left Arm', fallbackNames: ['left_arm'] },
      { key: K_LEFT_LOWER_ARM, recommendedName: 'Left Lower Arm', fallbackNames: ['left_lower_arm', 'Left Forearm'] },
      { key: K_RIGHT_ARM, recommendedName: 'Right Arm', fallbackNames: ['right_arm'] },
      { key: K_RIGHT_LOWER_ARM, recommendedName: 'Right Lower Arm', fallbackNames: ['right_lower_arm', 'Right Forearm'] },
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_LEFT_CALF, recommendedName: 'Left Calf', fallbackNames: ['left_calf', 'Left Lower Leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
      { key: K_RIGHT_CALF, recommendedName: 'Right Calf', fallbackNames: ['right_calf', 'Right Lower Leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 600,
    targetTracks: [
      {
        targetKey: K_BODY,
        tracks: [yOffsetTrack([
          { time: 0, y: 0 },
          { time: 0.25, y: -8 },
          { time: 0.5, y: 0 },
          { time: 0.75, y: 6 },
          { time: 1, y: 0 },
        ], 600)],
      },
      {
        targetKey: K_LEFT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-40) },
          { time: 0.25, rotation: deg(-12) },
          { time: 0.5, rotation: deg(40) },
          { time: 0.75, rotation: deg(12) },
          { time: 1, rotation: deg(-40) },
        ], 600)],
      },
      {
        // Left forearm: elbow flexes inward 15-40 deg; most bent +40 deg when upper arm swings back (t=0)
        targetKey: K_LEFT_LOWER_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(40) },
          { time: 0.25, rotation: deg(22) },
          { time: 0.5, rotation: deg(15) },
          { time: 0.75, rotation: deg(28) },
          { time: 1, rotation: deg(40) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(40) },
          { time: 0.25, rotation: deg(12) },
          { time: 0.5, rotation: deg(-40) },
          { time: 0.75, rotation: deg(-12) },
          { time: 1, rotation: deg(40) },
        ], 600)],
      },
      {
        // Right forearm: mirrored + half-cycle offset; most bent -40 deg when upper arm swings back (t=0.5)
        targetKey: K_RIGHT_LOWER_ARM,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-15) },
          { time: 0.25, rotation: deg(-28) },
          { time: 0.5, rotation: deg(-40) },
          { time: 0.75, rotation: deg(-22) },
          { time: 1, rotation: deg(-15) },
        ], 600)],
      },
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(45) },
          { time: 0.25, rotation: deg(16) },
          { time: 0.5, rotation: deg(-45) },
          { time: 0.75, rotation: deg(-16) },
          { time: 1, rotation: deg(45) },
        ], 600)],
      },
      {
        // Left calf: higher leg lift during run, mid swing (t=0.75) most bent -40 deg
        targetKey: K_LEFT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(0) },
          { time: 0.2, rotation: deg(0) },
          { time: 0.5, rotation: deg(-20) },
          { time: 0.75, rotation: deg(-40) },
          { time: 1, rotation: deg(0) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-45) },
          { time: 0.25, rotation: deg(-16) },
          { time: 0.5, rotation: deg(45) },
          { time: 0.75, rotation: deg(16) },
          { time: 1, rotation: deg(-45) },
        ], 600)],
      },
      {
        // Right calf: half-cycle offset - mid phase (t=0.2) most bent -40 deg, same sign as left calf
        targetKey: K_RIGHT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-20) },
          { time: 0.2, rotation: deg(-40) },
          { time: 0.5, rotation: deg(0) },
          { time: 0.7, rotation: deg(0) },
          { time: 1, rotation: deg(-20) },
        ], 600)],
      },
    ],
  },

  // --- Separate Leg Locomotion ---------------------------------

  {
    id: 'preset_walk_legs_only',
    name: 'Legs Walk',
    description: 'Legs-only walk swing, ideal for combining with arm actions',
    category: 'locomotion',
    tags: ['walk', 'legs', 'cycle'],
    origin: 'system',
    expectedTargets: [
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 1000,
    targetTracks: [
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(12) },
          { time: 0.5, rotation: deg(-12) },
          { time: 1, rotation: deg(12) },
        ])],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-12) },
          { time: 0.5, rotation: deg(12) },
          { time: 1, rotation: deg(-12) },
        ])],
      },
    ],
  },

  {
    id: 'preset_run_legs_only',
    name: 'Legs Run',
    description: 'Legs-only run swing, ideal for combining with arm actions',
    category: 'locomotion',
    tags: ['run', 'legs', 'cycle'],
    origin: 'system',
    expectedTargets: [
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 600,
    targetTracks: [
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(45) },
          { time: 0.5, rotation: deg(-45) },
          { time: 1, rotation: deg(45) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-45) },
          { time: 0.5, rotation: deg(45) },
          { time: 1, rotation: deg(-45) },
        ], 600)],
      },
    ],
  },

  {
    id: 'preset_walk_legs_only_fine',
    name: 'Legs Walk Detailed',
    description: 'Detailed legs-only walk swing with full leg swings and calf secondary motion',
    category: 'locomotion',
    tags: ['walk', 'legs', 'cycle', 'fine'],
    origin: 'system',
    expectedTargets: [
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_LEFT_CALF, recommendedName: 'Left Calf', fallbackNames: ['left_calf', 'Left Lower Leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
      { key: K_RIGHT_CALF, recommendedName: 'Right Calf', fallbackNames: ['right_calf', 'Right Lower Leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 1000,
    targetTracks: [
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(12) },
          { time: 0.25, rotation: deg(4) },
          { time: 0.5, rotation: deg(-12) },
          { time: 0.75, rotation: deg(-4) },
          { time: 1, rotation: deg(12) },
        ])],
      },
      {
        // Left calf: support phase straight, mid swing (t=0.75) most bent -25 deg
        targetKey: K_LEFT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(0) },
          { time: 0.25, rotation: deg(0) },
          { time: 0.5, rotation: deg(-10) },
          { time: 0.75, rotation: deg(-25) },
          { time: 1, rotation: deg(0) },
        ])],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-12) },
          { time: 0.25, rotation: deg(-4) },
          { time: 0.5, rotation: deg(12) },
          { time: 0.75, rotation: deg(4) },
          { time: 1, rotation: deg(-12) },
        ])],
      },
      {
        // Right calf: half-cycle offset, mid swing (t=0.25) most bent -25 deg, same sign
        targetKey: K_RIGHT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-10) },
          { time: 0.25, rotation: deg(-25) },
          { time: 0.5, rotation: deg(0) },
          { time: 0.75, rotation: deg(0) },
          { time: 1, rotation: deg(-10) },
        ])],
      },
    ],
  },

  {
    id: 'preset_run_legs_only_fine',
    name: 'Legs Run Detailed',
    description: 'Detailed legs-only run swing with full leg swings and calf speed motion',
    category: 'locomotion',
    tags: ['run', 'legs', 'cycle', 'fine'],
    origin: 'system',
    expectedTargets: [
      { key: K_LEFT_LEG, recommendedName: 'Left Leg', fallbackNames: ['left_leg'] },
      { key: K_LEFT_CALF, recommendedName: 'Left Calf', fallbackNames: ['left_calf', 'Left Lower Leg'] },
      { key: K_RIGHT_LEG, recommendedName: 'Right Leg', fallbackNames: ['right_leg'] },
      { key: K_RIGHT_CALF, recommendedName: 'Right Calf', fallbackNames: ['right_calf', 'Right Lower Leg'] },
    ],
    loop: true,
    fillMode: 'none',
    duration: 600,
    targetTracks: [
      {
        targetKey: K_LEFT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(45) },
          { time: 0.25, rotation: deg(16) },
          { time: 0.5, rotation: deg(-45) },
          { time: 0.75, rotation: deg(-16) },
          { time: 1, rotation: deg(45) },
        ], 600)],
      },
      {
        // Left calf: run leg lift, mid swing (t=0.75) most bent -40 deg
        targetKey: K_LEFT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(0) },
          { time: 0.2, rotation: deg(0) },
          { time: 0.5, rotation: deg(-20) },
          { time: 0.75, rotation: deg(-40) },
          { time: 1, rotation: deg(0) },
        ], 600)],
      },
      {
        targetKey: K_RIGHT_LEG,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-45) },
          { time: 0.25, rotation: deg(-16) },
          { time: 0.5, rotation: deg(45) },
          { time: 0.75, rotation: deg(16) },
          { time: 1, rotation: deg(-45) },
        ], 600)],
      },
      {
        // Right calf: half-cycle offset, mid phase (t=0.2) most bent -40 deg, same sign
        targetKey: K_RIGHT_CALF,
        tracks: [rotationTrack([
          { time: 0, rotation: deg(-20) },
          { time: 0.2, rotation: deg(-40) },
          { time: 0.5, rotation: deg(0) },
          { time: 0.7, rotation: deg(0) },
          { time: 1, rotation: deg(-20) },
        ], 600)],
      },
    ],
  },
]

// ===== Startup Validation =====

for (const template of PRESET_ANIMATIONS) {
  const errors = validatePresetTemplate(template)
  if (errors.length > 0) {
    throw new Error(`Preset animation template invalid: ${template.name}\n${errors.join('\n')}`)
  }
}
