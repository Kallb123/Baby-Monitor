export interface GridShape {
  columns: number
  rows: number
}

/**
 * Picks the column count that gives each tile the largest on-screen area for
 * the given container size. Handles portrait and landscape without special
 * cases: a tall phone stacks tiles, a wide tablet puts them side by side.
 */
export function bestGrid(
  count: number,
  width: number,
  height: number,
  tileAspect = 16 / 9,
): GridShape {
  if (count <= 0 || width <= 0 || height <= 0) return { columns: 1, rows: Math.max(count, 1) }
  let best: GridShape = { columns: 1, rows: count }
  let bestArea = -1
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.min(width / columns, (height / rows) * tileAspect)
    const area = (tileWidth * tileWidth) / tileAspect
    if (area > bestArea + 1e-6) {
      best = { columns, rows }
      bestArea = area
    }
  }
  return best
}
