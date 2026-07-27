import { useDisplaySettingsStore } from '../lib/useDisplaySettingsStore'
import ToggleRow from './ToggleRow'

export default function DisplaySettingsSection() {
  const showMonsterNames = useDisplaySettingsStore((state) => state.showMonsterNames)
  const showMonsterHealth = useDisplaySettingsStore((state) => state.showMonsterHealth)
  const setShowMonsterNames = useDisplaySettingsStore((state) => state.setShowMonsterNames)
  const setShowMonsterHealth = useDisplaySettingsStore((state) => state.setShowMonsterHealth)

  return (
    <div className="space-y-4">
      <ToggleRow label="Show monster names" checked={showMonsterNames} onChange={setShowMonsterNames} />
      <ToggleRow label="Show monster health bars" checked={showMonsterHealth} onChange={setShowMonsterHealth} />
    </div>
  )
}
