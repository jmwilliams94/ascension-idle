import type { SpriteFrameRect, SpriteSheet, SpriteTag } from './spriteSheet'

// Advances a per-instance playhead through one named tag's frame range on a
// timer. No generic "advance frame index every N ms" helper existed anywhere
// in this codebase (checked before writing this) -- the closest prior art is
// FxLayer.tsx's dt-clamped requestAnimationFrame loop, whose *shape* (not
// code) this is modeled on, adapted for frame-index advancement instead of
// procedural effect drawing.

export interface AnimatorState {
  tag: string
  frameIndex: number
  elapsedMs: number
  pingpongForward: boolean
}

export function createAnimatorState(tag: string): AnimatorState {
  return { tag, frameIndex: 0, elapsedMs: 0, pingpongForward: true }
}

// No-op if already on this tag -- switching resets to the tag's first frame
// so e.g. re-entering "attack" mid-animation always starts from the windup.
export function setAnimatorTag(state: AnimatorState, tag: string): void {
  if (state.tag === tag) return
  state.tag = tag
  state.frameIndex = 0
  state.elapsedMs = 0
  state.pingpongForward = true
}

function advanceFrame(tag: SpriteTag, state: AnimatorState, frameCount: number): void {
  if (tag.direction === 'reverse') {
    state.frameIndex = (state.frameIndex - 1 + frameCount) % frameCount
    return
  }
  if (tag.direction === 'pingpong') {
    if (state.pingpongForward) {
      state.frameIndex += 1
      if (state.frameIndex >= frameCount - 1) {
        state.frameIndex = frameCount - 1
        state.pingpongForward = false
      }
    } else {
      state.frameIndex -= 1
      if (state.frameIndex <= 0) {
        state.frameIndex = 0
        state.pingpongForward = true
      }
    }
    return
  }
  state.frameIndex = (state.frameIndex + 1) % frameCount
}

// Bounded loop (not a single `if`) so a large dt spike (e.g. a backgrounded
// tab) still catches the playhead up frame-by-frame rather than freezing on
// one frame for a long real-world stretch; capped at 60 steps as a sanity
// guard against a malformed (near-zero-duration) frame ever spinning forever.
export function stepAnimator(sheet: SpriteSheet, state: AnimatorState, dtMs: number): void {
  const tag = sheet.tags[state.tag]
  if (!tag) return
  const frameCount = tag.to - tag.from + 1
  if (frameCount <= 1) return

  state.elapsedMs += dtMs
  for (let guard = 0; guard < 60; guard++) {
    const currentDuration = sheet.frames[tag.from + state.frameIndex].durationMs
    if (state.elapsedMs < currentDuration) break
    state.elapsedMs -= currentDuration
    advanceFrame(tag, state, frameCount)
  }
}

export function currentFrameRect(sheet: SpriteSheet, state: AnimatorState): SpriteFrameRect | null {
  const tag = sheet.tags[state.tag]
  if (!tag) return null
  return sheet.frames[tag.from + state.frameIndex]
}
