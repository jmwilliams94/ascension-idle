import { toCanvas } from 'html-to-image'

// Caps the captured texture's CSS-pixel width regardless of the real
// viewport size -- the shader distorts this heavily within well under a
// second (see WarpLayer.tsx), so source resolution barely matters visually,
// but it matters a lot for cost: a wide/high-DPI monitor's full viewport is
// both slower for html-to-image to rasterize and a real GPU texture-upload
// cost when WarpLayer hands it to CanvasTexture. 1280 keeps both cheap on
// any screen size without visibly hurting the warped result.
const MAX_CAPTURE_WIDTH = 1280

// Rasterizes the current page into a plain <canvas> for WarpLayer.tsx's
// WebGL shockwave shader to use as its texture -- the only way to actually
// distort the real on-screen UI rather than draw effects on top of it (see
// FxLayer.tsx's own doc comment on why the plain-canvas ember/lightning
// system can't do that). skipFonts trades perfectly rendered Cinzel
// headings for a fast, reliable capture -- acceptable since the result is
// only ever shown warped/distorted for well under a second, never read as
// text.
//
// Explicit width/height bound this to the viewport, not document.body's
// full scrollable size (html-to-image defaults to the target node's own
// bounding box, which can be taller than the viewport on any scrollable
// page) -- capturing extra off-screen content the player can't even see was
// pure wasted cost.
//
// Images are excluded via `filter` (not just data-fx-exclude'd FX canvases)
// -- html-to-image's default behavior is to fetch and base64-embed every
// visible <img> so the clone renders identically to the original, but this
// game's item icons/zone art are real network images (Supabase Storage),
// and fetching+encoding dozens of them was almost certainly the dominant
// cost behind the visible "screen freezes up" the user reported right at
// impact. Losing icon detail in the captured texture is an acceptable
// trade -- the whole thing gets heavily warped within a few hundred ms
// regardless, an icon-shaped blur reads the same as a photo-accurate one.
//
// Can still reject -- e.g. a CORS-tainted background-image the filter
// doesn't catch (it only excludes <img> elements, not CSS backgrounds).
// Callers should treat that as "no warp this time" rather than something to
// surface to the player; see useWarpStore.ts's triggerWarp.
export function captureScreen(): Promise<HTMLCanvasElement> {
  const width = window.innerWidth
  const height = window.innerHeight
  const pixelRatio = Math.min(1, MAX_CAPTURE_WIDTH / width)

  return toCanvas(document.body, {
    width,
    height,
    skipFonts: true,
    pixelRatio,
    filter: (node) => {
      if (node instanceof HTMLElement && node.dataset.fxExclude === 'true') {
        return false
      }
      if (node instanceof HTMLImageElement) {
        return false
      }
      return true
    },
  })
}
