import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { Bubble, Turn } from '../types'
import { SPRITES, type Band } from './sprites'

const percent = atom({ plugin: 'clawd-meter', key: 'percent' } as const, 0)
const history = atom({ plugin: 'clawd-meter', key: 'history' } as const, [])
const turn = atom({ plugin: 'clawd-meter', key: 'turn' } as const, {
  working: false, startedAt: 0, endedAt: 0, tools: 0, lastTool: '',
})
const bubble = atom({ plugin: 'clawd-meter', key: 'bubble' } as const, {
  text: 'hi! fresh context, plenty of room.', source: 'note', turn: 0,
})
const tick = atom({ plugin: 'clawd-meter', key: 'tick' } as const, 0)
const seen = atom({ plugin: 'clawd-meter', key: 'seen' } as const, [])

// ── scale (same as the compact statusline) ────────────────────────────────
const SCALE: Array<[number, Band, string, Color]> = [
  [40, 'sharp', '(^‿^)', 'success'],
  [60, 'coasting', '(•‿•)', 'suggestion'],
  [75, 'foggy', '(•_•)', 'warning'],
  [90, 'cooked', '(x_x)', 'error'],
  [101, 'dumb', '(°﹃°)', 'claude'],
]
const THRESHOLDS: Array<[number, Band]> = [[40, 'coasting'], [60, 'foggy'], [75, 'cooked'], [90, 'dumb']]

function bandOf(p: number): { band: Band; face: string; color: Color } {
  for (const [limit, band, face, color] of SCALE) {
    if (p < limit) return { band, face, color }
  }
  return { band: 'dumb', face: '(°﹃°)', color: 'claude' }
}

// ── what the mascot says ──────────────────────────────────────────────────
const QUIPS: Record<Band, string[]> = {
  sharp: ['context is crisp. let\'s build.', 'fresh brain, who dis', 'plenty of room in here', 'sharp as a tack (^‿^)'],
  coasting: ['cruising.', 'still got room', 'humming along', 'all systems nominal'],
  foggy: ['getting a little foggy in here...', 'I remember most of it. probably.', 'a /compact soon wouldn\'t hurt'],
  cooked: ['I\'m cooked. /compact?', 'my context runneth over', 'save a memory before I forget'],
  dumb: ['duhh... /compact pls', 'what were we doing?', 'brain full. (°﹃°)'],
}
const NUDGES: Partial<Record<Band, string>> = {
  foggy: 'getting foggy (60%). good time to wrap up a thread.',
  cooked: 'cooked (75%). /compact soon, or save what matters to memory.',
  dumb: 'past 90%. /compact or /clear before I start forgetting.',
}
// Slash commands whose output the bubble repeats. CLAWD_METER_CAPTURE adds more
// (comma-separated, no slash); CLAWD_METER_DEBUG=1 repeats every command's output
// with its name, to find out what a command is called.
const CAPTURE = ['btw', 'insights', 'you-should-know', 'ysk']
const KEEP_TURNS = 3 // a captured or nudge message outlives this many turns before quips resume

let mode: 'image' | 'raster' = 'raster'
let capture = new Set(CAPTURE)
let debug = false
let stopTicker: (() => void) | undefined

function hash(s: string): string {
  let acc = 5381
  for (let i = 0; i < s.length; i++) acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
  return (acc >>> 0).toString(36)
}

function plain(md: string): string {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

/** Wrap to at most `lines` lines of `width`, ending in … when cut. */
function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= width) { cur = next; continue }
    if (cur) out.push(cur)
    cur = word.length > width ? word.slice(0, width) : word
    if (out.length === lines) break
  }
  if (out.length < lines && cur) out.push(cur)
  const cut = out.join(' ').length < text.length
  const kept = out.slice(0, lines)
  const last = kept[kept.length - 1]
  if (cut && last !== undefined) {
    kept[kept.length - 1] = (last.length >= width ? last.slice(0, width - 1) : last) + '…'
  }
  return kept
}

const SPARK = '▁▂▃▄▅▆▇█'

function trendText(hist: number[], p: number): { eta: string; rate: string } {
  const pts = [...hist.slice(-6)]
  if (pts[pts.length - 1] !== p) pts.push(p)
  const first = pts[0] ?? p
  const slope = pts.length >= 2 ? (p - first) / (pts.length - 1) : 0
  const rate = pts.length >= 2 ? `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}%/turn` : 'measuring...'
  if (p >= 90) return { eta: 'past the edge', rate }
  if (slope < 0.3) return { eta: 'holding steady', rate }
  const next = THRESHOLDS.find(([t]) => t > p)
  if (!next) return { eta: 'holding steady', rate }
  const turns = Math.max(1, Math.ceil((next[0] - p) / slope))
  return { eta: `~${turns} turn${turns === 1 ? '' : 's'} to ${next[1]}`, rate }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const forced = await $.env.get('CLAWD_METER_MODE')
    const term = (await $.env.get('TERM')) ?? ''
    mode = forced === 'image' || forced === 'raster' ? forced : /ghostty|kitty/.test(term) ? 'image' : 'raster'
    const extra = (await $.env.get('CLAWD_METER_CAPTURE')) ?? ''
    capture = new Set([...CAPTURE, ...extra.split(',').map(s => s.trim().replace(/^\//, '')).filter(Boolean)])
    debug = (await $.env.get('CLAWD_METER_DEBUG')) === '1'
    const { context } = await $.session.usage()
    await update($, percent, () => context.percent ?? 0)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const p = e.context.percent
    if (p === undefined) return result
    const before = await read($, percent)
    await update($, percent, () => p)
    if (before - p >= 15) {
      // context dropped a lot: a compaction (or /clear) happened
      await update($, history, () => [p])
      const n = (await read($, history)).length
      await update($, bubble, () => ({ text: `ahh, fresh context. (${before}% → ${p}%)`, source: 'note', turn: n }))
    }

    return result
  })

  // These two sit in the path of the person's prompts and tool calls: bookkeeping
  // here must never throw into them, so each failure is swallowed.
  on('prompt.submit', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      await update($, turn, () => ({ working: true, startedAt: now, endedAt: 0, tools: 0, lastTool: '' }))
      stopTicker?.()
      const timer = $.clock.every(1000, () => { update($, tick, t => t + 1).catch(() => undefined) })
      stopTicker = () => timer.cancel()
    } catch {
      // the band just misses this turn's timer
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, turn, t => ({ ...t, tools: t.tools + 1, lastTool: e.tool })).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    stopTicker?.()
    stopTicker = undefined
    const now = await $.clock.now()
    const t = await update($, turn, t => ({ ...t, working: false, endedAt: now }))
    const p = await read($, percent)
    const prev = (await read($, history)).slice(-1)[0]
    const hist = await update($, history, list => [...list, p].slice(-60))
    const n = hist.length
    const was = prev === undefined ? undefined : bandOf(prev).band
    const { band } = bandOf(p)
    const current = await read($, bubble)
    const stale = current.source === 'quip' || n - current.turn >= KEEP_TURNS
    let said: Bubble | undefined
    if (was !== undefined && was !== band && NUDGES[band] && SCALE.findIndex(s => s[1] === band) > SCALE.findIndex(s => s[1] === was)) {
      said = { text: NUDGES[band] ?? '', source: 'nudge', turn: n }
    } else if (stale && t.endedAt - t.startedAt > 120_000) {
      said = { text: `that one took ${fmt(t.endedAt - t.startedAt)} and ${t.tools} tool calls. phew.`, source: 'note', turn: n }
    } else if (stale) {
      const q = QUIPS[band]
      said = { text: q[n % q.length] ?? 'hm.', source: 'quip', turn: n }
    }
    if (said) {
      const s = said
      await update($, bubble, () => s)
    }

    return next(e)
  })

  // Repeat what chosen slash commands printed (e.g. /btw) in the bubble.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const { command, text, isErrored } = e.props
    if (!isErrored && text && (debug || capture.has(command))) {
      const id = hash(`${command}\n${text}`)
      const known = await read($, seen)
      if (!known.includes(id)) {
        await update($, seen, list => [...list, id].slice(-80))
        const n = (await read($, history)).length
        const body = plain(text)
        await update($, bubble, () => ({ text: debug ? `/${command}: ${body}` : body, source: 'capture', turn: n }))
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Image, Raster, Text } = $.ui.resolve(e)
    await read($, tick) // redraw every second while a turn runs
    const p = await read($, percent)
    const { band, face, color } = bandOf(p)
    const hist = await read($, history)
    const t: Turn = await read($, turn)
    const said: Bubble = await read($, bubble)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const sprite = SPRITES[band]

    const picture =
      mode === 'image' ? (
        <Image key="clawd" source={{ png: sprite.png }} columns={12} rows={4} alt={face} />
      ) : (
        <Raster key="clawd" columns={12} rows={4} cells={sprite.cells} />
      )

    // Narrowing drops one block at a time, as the statusline does: activity
    // first, then the trend, then the bubble; the mascot always stays.
    // Mascot 12 + tail 1, trend 24+2, activity 22+2, bubble at least ~20.
    const showActivity = cols >= 84
    const showTrend = cols >= 60
    const showBubble = cols >= 32

    // ── trend ──
    const points = [...hist.slice(-17), p]
    const trend = trendText(hist, p)
    const trendBox = (
      <Box flexDirection="column" width={24} marginRight={2}>
        <Box>
          <Text dimColor>ctx </Text>
          {points.map((v, i) => (
            <Text key={`s${i}`} color={bandOf(v).color}>{SPARK[Math.min(7, Math.floor((v / 100) * 8))]}</Text>
          ))}
        </Box>
        <Text color={color} bold>{`${p}% ${band}`}</Text>
        <Text>{trend.eta}</Text>
        <Text dimColor>{trend.rate}</Text>
      </Box>
    )

    // ── activity ──
    const elapsed = fmt((t.working ? now : t.endedAt) - t.startedAt)
    const activityBox = (
      <Box flexDirection="column" width={22} marginRight={2}>
        {t.working ? <Text color="claude" bold>{`● working ${elapsed}`}</Text> : <Text dimColor>{t.startedAt ? `last turn ${elapsed}` : 'no turns yet'}</Text>}
        <Text>{`${t.tools} tool call${t.tools === 1 ? '' : 's'}`}</Text>
        <Text dimColor>{t.working ? (t.lastTool ? `now: ${t.lastTool}` : 'thinking...') : 'idle'}</Text>
        <Text> </Text>
      </Box>
    )

    // ── bubble ──
    const avail = cols - 13 - (showTrend ? 26 : 0) - (showActivity ? 24 : 0)
    const inner = Math.max(8, Math.min(avail - 4, 60))
    const lines = wrap(said.text, inner, 2)
    const width = Math.min(avail, Math.max(...lines.map(l => l.length)) + 4)
    const bubbleBox = (
      <Box flexDirection="row" alignItems="center">
        <Box borderStyle="single" borderColor={said.source === 'capture' ? 'suggestion' : 'inactive'} paddingX={1} width={width} flexDirection="column">
          {lines.map((l, i) => <Text key={`b${i}`}>{l}</Text>)}
        </Box>
        <Text color="inactive">▶</Text>
      </Box>
    )

    return (
      <Box width={cols} flexDirection="row" justifyContent="flex-end" alignItems="flex-end">
        {showTrend ? trendBox : null}
        {showActivity ? activityBox : null}
        <Box flexGrow={1} justifyContent="flex-end">{showBubble ? bubbleBox : null}</Box>
        {picture}
      </Box>
    )
  })
}
