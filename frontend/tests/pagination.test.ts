import { expect, it, vi } from 'vitest'
import { fetchAllRows } from '../src/lib/pagination'

it('loads beyond 2,000 rows even when the server caps pages below the requested size', async () => {
  const rows = Array.from({ length: 2151 }, (_, id) => ({ id }))
  const range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + 100)), error: null }))
  const result = await fetchAllRows(() => ({ range }))
  expect(result.data).toEqual(rows)
  expect(result.error).toBeNull()
  expect(range.mock.calls[1][0]).toBe(100)
})
it('discards partial data when a later page fails', async () => {
  const range = vi.fn().mockResolvedValueOnce({ data: [{ id: 1 }], error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'Connection lost' } })
  expect(await fetchAllRows(() => ({ range })))
    .toEqual({ data: null, error: { message: 'Connection lost' } })
})
it('turns a network exception into a recoverable read error', async () => {
  expect(await fetchAllRows(() => ({ range: () => Promise.reject(new Error('Offline')) })))
    .toEqual({ data: null, error: { message: 'Offline' } })
})
