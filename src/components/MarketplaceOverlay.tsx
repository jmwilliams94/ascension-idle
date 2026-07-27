import OverlayPanel from './OverlayPanel'
import MarketplacePanel from './MarketplacePanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'

export default function MarketplaceOverlay() {
  const close = useOverlayStore((state) => state.close)

  return (
    <OverlayPanel title="Marketplace" onClose={close}>
      <MarketplacePanel />
    </OverlayPanel>
  )
}
