import OverlayPanel from './OverlayPanel'
import EquipmentPanel from './EquipmentPanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'

export default function EquipmentOverlay() {
  const close = useOverlayStore((state) => state.close)

  return (
    <OverlayPanel title="Equipment" onClose={close}>
      <EquipmentPanel />
    </OverlayPanel>
  )
}
