import { toCanvas } from 'html-to-image'

// Rasterizes the current page into a plain <canvas> for WarpLayer.tsx's
// WebGL shockwave shader to use as its texture -- the only way to actually
// distort the real on-screen UI rather than draw effects on top of it (see
// FxLayer.tsx's own doc comment on why the plain-canvas ember/lightning
// system can't do that). skipFonts trades perfectly rendered Cinzel
// headings for a fast, reliable capture -- acceptable since the result is
// only ever shown warped/distorted for well under a second, never read as
// text. pixelRatio 1 (not devicePixelRatio) keeps the capture itself cheap;
// the shader displaces it enough that source resolution barely matters.
//
// Elements tagged data-fx-exclude (FxLayer's own 2D canvas, WarpLayer's own
// WebGL canvas) are skipped so a mid-animation ember/lightning frame or a
// previous warp's canvas doesn't get baked into the captured texture.
//
// Can reject -- most likely an image resource (item icons, zone art) served
// without permissive CORS headers tainting the capture. Callers should treat
// that as "no warp this time" rather than something to surface to the
// player; see useWarpStore.ts's triggerWarp.
export function captureScreen(): Promise<HTMLCanvasElement> {
  return toCanvas(document.body, {
    skipFonts: true,
    pixelRatio: 1,
    filter: (node) => !(node instanceof HTMLElement && node.dataset.fxExclude === 'true'),
  })
}
