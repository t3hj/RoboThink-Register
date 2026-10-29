import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const tokens = (selector: string) => Object.fromEntries([...css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector))).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
const root = tokens(':root {')
function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function contrast(a: string, b: string) { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + 0.05) / (values[0] + 0.05) }
for (const [brand, palette] of [['RoboThink', root], ['Creative IQ', { ...root, ...tokens("[data-brand='creative_iq'] {") }]] as const) {
  describe(`${brand} functional colour contrast`, () => {
    const colour = (token: string): string => palette[token].startsWith('var(') ? colour(palette[token].slice(4, -1)) : palette[token]
    it('keeps small action text readable on its button surface', () => {
      expect(contrast('#ffffff', colour('--rt-primary'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#ffffff', colour('--rt-danger'))).toBeGreaterThanOrEqual(4.5)
    })
    it('keeps links readable on both white and tinted surfaces', () => {
      expect(contrast(colour('--rt-link'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour('--rt-link'), colour('--rt-blue-tint'))).toBeGreaterThanOrEqual(4.5)
    })
    it('keeps secondary text readable on cards and the page background', () => {
      expect(contrast('#475569', '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#475569', colour('--rt-paper'))).toBeGreaterThanOrEqual(4.5)
    })
  })
}
