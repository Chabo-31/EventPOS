import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'onFocus' | 'onBlur'> & {
  value: string
  onValueChange: (value: string) => void
}
export default function NumberInput({ value, onValueChange, ...props }: Props) {
  const [focused, setFocused] = useState(false)
  return <input {...props} type="number" inputMode="numeric"
    value={focused ? value : value === '' ? '0' : value}
    onFocus={() => { setFocused(true); if (value === '0' || value === '') onValueChange('') }}
    onChange={e => onValueChange(e.target.value)}
    onBlur={() => { setFocused(false); if (value === '') onValueChange('0') }}
  />
}
