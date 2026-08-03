import type { NavIcon } from '../game/hud/navIcons'

// Shared between MobileBottomNav.tsx and TabNav.tsx — sizeClassName lets
// each bar pick its own icon size (mobile's compact bar vs. desktop's more
// spacious buttons) without duplicating the emoji-vs-image branch.
export default function NavIconGlyph({ icon, sizeClassName = 'h-6 w-6' }: { icon: NavIcon; sizeClassName?: string }) {
  if (icon.kind === 'image') {
    return <img src={icon.src} alt={icon.alt} className={`${sizeClassName} object-contain`} />
  }
  return <span className="text-lg leading-none">{icon.value}</span>
}
