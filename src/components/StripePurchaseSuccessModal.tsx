import BankActionModal from './BankActionModal'
import { Button } from './ui/Button'

// Confirmation dialog for the Stripe VIP Token purchase return leg (see
// GameShell.tsx's ?stripe=success handling, VipShopPanel.tsx) — replaced the
// original GainToastStore toast (2026-09-03, requested by the user: a real
// popup reads more like a confirmed transaction than a corner toast does).
// Same violet VIP tint as VipStatusHud/VipSettingsModal/VipShopPanel.
export default function StripePurchaseSuccessModal({ onClose }: { onClose: () => void }) {
  return (
    <BankActionModal title="Transaction Successful!" onClose={onClose} tint="#8b5cf6" widthClassName="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-200">Thank you for your purchase! Please check your Mail (Market tab) to claim your VIP Token.</p>
        <Button className="w-full" onClick={onClose}>
          Confirm
        </Button>
      </div>
    </BankActionModal>
  )
}
