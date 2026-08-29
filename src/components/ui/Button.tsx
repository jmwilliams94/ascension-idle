import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

// No width set here on purpose — most call sites want w-full (pass it via
// className), but plenty of inline/tile-popover buttons don't.
const BASE_CLASSES = 'rounded-lg px-4 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40'

// gold = the one CTA color app-wide now (Fight/Buy/Confirm/Claim/Equip);
// steel gradient for neutral actions; red outline for destructive ones.
// See src/index.css's .btn-gold/.btn-steel for the gradient/glow treatment.
// secondary shares primary's bold/uppercase/Cinzel treatment (2026-08-30,
// previously plain font-medium mixed-case, which read as visibly "off"
// whenever a bold uppercase button sat right next to it — reported by the
// user against Forge's Confirm/Auto-Repeat row) — only the color ramp
// (steel vs gold) tells the two variants apart now, not the typography.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-gold font-heading font-bold uppercase tracking-[0.12em]',
  secondary: 'btn-steel font-heading font-bold uppercase tracking-[0.12em]',
  danger: 'border border-rose-700 bg-transparent font-medium text-rose-300 hover:border-rose-500',
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`} {...props} />
}
