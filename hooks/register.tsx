import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { SPRITES, type Band } from './sprites'

// Live context fill, 0-100, as the status line reports it.
const percent = atom({ plugin: 'clawd-meter', key: 'percent' } as const, 0)

// Same scale as the compact statusline's word and face.
const SCALE: Array<[number, Band, string]> = [
  [40, 'sharp', '(^‿^)'],
  [60, 'coasting', '(•‿•)'],
  [75, 'foggy', '(•_•)'],
  [90, 'cooked', '(x_x)'],
  [101, 'dumb', '(°﹃°)'],
]
const COLUMNS = 12
const ROWS = 4

// 'image': a real PNG over the cells (kitty graphics: Ghostty, kitty).
// 'raster': half-block truecolor cells, for terminals without it (foot).
type Mode = 'image' | 'raster'
let mode: Mode = 'raster'

function pick(p: number): [Band, string] {
  for (const [limit, band, face] of SCALE) {
    if (p < limit) return [band, face]
  }
  return ['dumb', '(°﹃°)']
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const forced = await $.env.get('CLAWD_METER_MODE')
    const term = (await $.env.get('TERM')) ?? ''
    if (forced === 'image' || forced === 'raster') {
      mode = forced
    } else {
      mode = /ghostty|kitty/.test(term) ? 'image' : 'raster'
    }
    const { context } = await $.session.usage()
    await update($, percent, () => context.percent ?? 0)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.context.percent !== undefined) {
      const p = e.context.percent
      await update($, percent, () => p)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Image, Raster } = $.ui.resolve(e)
    const [band, face] = pick(await read($, percent))
    const sprite = SPRITES[band]
    const picture =
      mode === 'image' ? (
        <Image key="clawd" source={{ png: sprite.png }} columns={COLUMNS} rows={ROWS} alt={face} />
      ) : (
        <Raster key="clawd" columns={COLUMNS} rows={ROWS} cells={sprite.cells} />
      )

    return (
      <Box width={e.props.bodyColumns} justifyContent="flex-end">
        {picture}
      </Box>
    )
  })
}
