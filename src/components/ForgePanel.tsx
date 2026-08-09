import { useState } from 'react'
import EnchantressPanel from './EnchantressPanel'
import ForgeCompositionTab from './ForgeCompositionTab'
import ForgeHub, { type ForgeMode } from './ForgeHub'
import ForgeSocketsTab from './ForgeSocketsTab'
import ForgeStandardPanel from './ForgeStandardPanel'
import MasterForgePanel from './MasterForgePanel'
import SalvagePanel from './SalvagePanel'

// Forge (2026-08-13 redesign) — a hub of 6 large tiles (ForgeHub) routing
// into one of 6 two-column detail panels (ForgeTwoColumnLayout: Inventory on
// the left, that panel's own upgrade slots/controls on the right). Supersedes
// the old cramped 4-button toggle row with Composition folded invisibly into
// the Forge tile's own drag-detection, and every panel's old single centered
// column.
export default function ForgePanel() {
  const [mode, setMode] = useState<ForgeMode | null>(null)

  const handleBack = () => setMode(null)

  if (mode === null) {
    return <ForgeHub onSelect={setMode} />
  }

  switch (mode) {
    case 'standard':
      return <ForgeStandardPanel onBack={handleBack} />
    case 'master':
      return <MasterForgePanel onBack={handleBack} />
    case 'composition':
      return <ForgeCompositionTab onBack={handleBack} />
    case 'salvage':
      return <SalvagePanel onBack={handleBack} />
    case 'sockets':
      return <ForgeSocketsTab onBack={handleBack} />
    case 'enchant':
      return <EnchantressPanel onBack={handleBack} />
    default:
      return null
  }
}
