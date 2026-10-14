import type { BrandId } from '../lib/brand'
import { useBrand } from '../lib/brand'

const BRANDS: { id: BrandId; label: string }[] = [
  { id: 'robothink', label: 'RoboThink' },
  { id: 'creative_iq', label: 'Creative IQ' },
]

export default function BrandSwitcher() {
  const { activeBrand, saving, setActiveBrand } = useBrand()

  return (
    <div className="brand-switcher mb-4" role="group" aria-label="Switch organisation">
      <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Organisation</span>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        {BRANDS.map((brand) => (
          <button
            key={brand.id}
            type="button"
            className={[
              'min-h-9 rounded-md px-2 text-xs font-semibold transition-colors',
              activeBrand === brand.id
                ? 'bg-white text-[color:var(--rt-primary)] shadow-sm'
                : 'text-slate-600 hover:bg-white/70',
            ].join(' ')}
            aria-pressed={activeBrand === brand.id}
            disabled={saving}
            onClick={() => void setActiveBrand(brand.id)}
          >
            {brand.label}
          </button>
        ))}
      </div>
    </div>
  )
}
