import { useDisplaySettingsStore } from '../lib/useDisplaySettingsStore'
import ToggleRow from './ToggleRow'

export default function DisplaySettingsSection() {
  const showMonsterNames = useDisplaySettingsStore((state) => state.showMonsterNames)
  const showMonsterHealth = useDisplaySettingsStore((state) => state.showMonsterHealth)
  const showItemDropText = useDisplaySettingsStore((state) => state.showItemDropText)
  const setShowMonsterNames = useDisplaySettingsStore((state) => state.setShowMonsterNames)
  const setShowMonsterHealth = useDisplaySettingsStore((state) => state.setShowMonsterHealth)
  const setShowItemDropText = useDisplaySettingsStore((state) => state.setShowItemDropText)

  return (
    <div className="space-y-4">
      <ToggleRow label="Show monster names" checked={showMonsterNames} onChange={setShowMonsterNames} />
      <ToggleRow label="Show monster health bars" checked={showMonsterHealth} onChange={setShowMonsterHealth} />
      <ToggleRow label="Show item drop text" checked={showItemDropText} onChange={setShowItemDropText} />
    </div>
  )
}
