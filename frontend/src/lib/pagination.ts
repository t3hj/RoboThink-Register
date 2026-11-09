/** Read every page, including when the server caps pages below our request.
 * Callers must supply a stable, unique order (normally order('id')).
 * Discard partial results on failure so callers cannot mistake them for complete data.
 */
interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}
interface PageQuery<T> {
  range: (from: number, to: number) => PromiseLike<PageResult<T>>
}
export async function fetchAllRows<T>(makeQuery: () => PageQuery<T>): Promise<PageResult<T>> {
  const rows: T[] = []
  try {
    for (;;) {
      const { data, error } = await makeQuery().range(rows.length, rows.length + 499)
      if (error) return { data: null, error }
      if (!data?.length) return { data: rows, error: null }
      rows.push(...data)
    }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Unable to load all records' } }
  }
}
