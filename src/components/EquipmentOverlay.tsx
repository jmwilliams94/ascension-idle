import OverlayPanel from './OverlayPanel'
import EquipmentPanel from './EquipmentPanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'

export default function EquipmentOverlay() {
  const close = useOverlayStore((state) => state.close)
  const level = useProgressionStore((state) => state.level)

  return (
    <OverlayPanel title={`Lv. ${level} — Equipment`} onClose={close}>
      <EquipmentPanel />
    </OverlayPanel>
  )
}
