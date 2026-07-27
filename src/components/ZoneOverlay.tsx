import OverlayPanel from './OverlayPanel'
import ZonePanel from './ZonePanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'

export default function ZoneOverlay() {
  const close = useOverlayStore((state) => state.close)

  return (
    <OverlayPanel title="Zone" onClose={close}>
      <ZonePanel />
    </OverlayPanel>
  )
}
