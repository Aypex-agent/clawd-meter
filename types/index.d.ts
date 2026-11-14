/** Context window fill, 0 to 100, as the status line reports it. */
export type ContextPercent = number

declare module 'claude-code' {
  interface PluginState {
    'clawd-meter': { percent: ContextPercent }
  }
}
