/**
 * Money, weight and dates in en-BD (CLAUDE.md section 9).
 *
 * Every number these produce is rendered in the mono face with tabular
 * figures — see the `.mono` class — so columns of prices line up.
 */

const takaFormatter = new Intl.NumberFormat('en-BD', {
  maximumFractionDigits: 0,
})

/** ৳ 1,250 — the symbol is spaced so it does not crowd the digits. */
export const formatTaka = (amount: number): string =>
  `৳ ${takaFormatter.format(Math.round(amount))}`

/** 2 kg, 0.5 kg — trailing zeros dropped, because 2.0 kg reads as precision. */
export const formatKg = (kg: number): string =>
  `${Number(kg.toFixed(2))} kg`

export const formatKm = (km: number): string => `${km.toFixed(1)} km`

const dateFormatter = new Intl.DateTimeFormat('en-BD', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatDateTime = (d: Date | string): string =>
  dateFormatter.format(typeof d === 'string' ? new Date(d) : d)
