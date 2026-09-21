'use client'

import type { PlayerGender } from '@/domain/types'

const choices: { value: PlayerGender; label: string }[] = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'unspecified', label: 'ไม่ระบุ' },
]

function GenderGlyph({ gender }: { gender: PlayerGender }) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="size-6 shrink-0">
    <ellipse cx="12.5" cy="12" rx="8" ry="9" />
    <path d="M9 5V19M13 4V20M17 6V18M6 9H19M5 13H20M7 17H18" strokeWidth=".7" opacity=".4" />
    {gender === 'male' ? <path d="M19 6L27 2M21 2H27V8" /> : gender === 'female' ? <path d="M12.5 21V30M7.5 26H17.5" /> : <path d="M12.5 21V29M21 26H28" />}
  </svg>
}

export function GenderIcon({ gender = 'unspecified' }: { gender?: PlayerGender }) {
  const choice = choices.find(choice => choice.value === gender) ?? choices[2]
  return <span role="img" aria-label={`เพศ: ${choice.label}`} title={choice.label} className="inline-flex min-w-5 items-center justify-center leading-none text-accent"><GenderGlyph gender={choice.value} /></span>
}

export function GenderSelector({ name = 'gender', defaultValue = 'unspecified', value, onChange, disabled = false, label = 'เพศสำหรับจัดคู่' }: {
  name?: string
  defaultValue?: PlayerGender
  value?: PlayerGender
  onChange?: (gender: PlayerGender) => void
  disabled?: boolean
  label?: string
}) {
  return <fieldset disabled={disabled}>
    <legend className="mb-2 text-sm font-semibold">{label}</legend>
    <div className="flex flex-wrap gap-2">{choices.map(choice => <label key={choice.value} title={choice.label} className="cursor-pointer">
      <input type="radio" name={name} value={choice.value} aria-label={choice.label} className="peer sr-only" {...(value === undefined ? { defaultChecked: defaultValue === choice.value } : { checked: value === choice.value })} onChange={() => onChange?.(choice.value)} />
      <span className="flex min-h-12 min-w-20 items-center justify-center gap-2 rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:font-semibold peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"><GenderGlyph gender={choice.value} />{choice.label}</span>
    </label>)}</div>
  </fieldset>
}
