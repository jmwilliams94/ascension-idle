import OverlayPanel from './OverlayPanel'
import ForgePanel from './ForgePanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'

export default function ForgeOverlay() {
  const close = useOverlayStore((state) => state.close)

  return (
    <OverlayPanel title="Forge" onClose={close}>
      <ForgePanel />
    </OverlayPanel>
  )
}
