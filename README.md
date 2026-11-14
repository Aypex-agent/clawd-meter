# clawd-meter

A Claude Code mod that puts a small pixel-art mascot, a fan-made take on the orange
Claude mascot, right-aligned in the band above the prompt. Its expression follows how full
the context window is, on the same scale as
[claude-compact-statusline](https://github.com/Aypex-agent/claude-compact-statusline):

| Context used | Band     |
|-------------:|----------|
| under 40%    | sharp    |
| 40 to 60%    | coasting |
| 60 to 75%    | foggy    |
| 75 to 90%    | cooked   |
| 90% and up   | dumb     |

![the five bands](assets/preview.png)

## The band

Left of the mascot, the band fills in as there's room. Narrowing drops one block at a time
(activity first, then the trend, then the bubble), so it works from a phone terminal up:

| Band width | Shows |
|---|---|
| 84+ columns | trend, activity, bubble, mascot |
| 60–83 | trend, bubble, mascot |
| 32–59 | bubble, mascot |
| under 32 | mascot only |

When the band has fewer than 4 rows (a phone with its on-screen keyboard up, say), it switches to
one right-aligned line: the bubble's text cut to fit, then the band's face, e.g. `cruising. (•‿•)`.

- **Context trend:** a sparkline of context fill at the end of each turn, coloured by band; the
  current percentage; an estimate like `~5 turns to foggy` from the recent growth rate; and the rate
  per turn.
- **Turn activity:** `● working 1m12s` with a live timer, the tool call count and the tool running
  now; once the turn ends, how long it took.
- **Speech bubble:** the mascot talks. In priority order:
  1. the output of chosen slash commands (by default `/btw`, `/insights`, `/you-should-know`, `/ysk`);
  2. a nudge when the context crosses into a worse band, such as "cooked (75%). /compact soon…";
  3. a note when context drops after a compaction, or after a turn over two minutes;
  4. a band-flavoured quip otherwise.

  A captured or nudge message stays up for 3 turns before quips resume.

Colours use Claude Code's theme keys, so they follow your theme.

### Options (environment variables)

| Variable | Effect |
|---|---|
| `CLAWD_METER_MODE` | `image` or `raster` to force a renderer |
| `CLAWD_METER_CAPTURE` | More slash commands whose output the bubble repeats, comma-separated, e.g. `review,standup` |
| `CLAWD_METER_DEBUG` | `1` repeats every command's output with its name, to find out what a command is called |

Set them in the `env` block of `~/.claude/settings.json`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-meter --marketplace Aypex-agent/clawd-meter
```

Answer `y` to add the marketplace, then pick a scope (user is first). From a shell:

```sh
claude plugin install clawd-meter --marketplace Aypex-agent/clawd-meter
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
then Add marketplace with `Aypex-agent/clawd-meter`, then Add plugin.

The band can be collapsed with its `[-]` button or **Ctrl+X Ctrl+A**; the same keys bring it back.

## Rendering

- **Ghostty and kitty** (`TERM` contains `ghostty` or `kitty`): a real PNG through the kitty
  graphics protocol. The 24x16 sprite is stored upscaled 8x with nearest-neighbour scaling,
  so it stays crisp.
- **Everything else, foot included:** a 12x8 sprite drawn as half-block (`▀`) truecolor cells.
- Force either one with `CLAWD_METER_MODE=image` or `CLAWD_METER_MODE=raster`.

The band is 12 columns by 4 rows. With the compact statusline, set `PHONE_SL_FACE=0` so the
ASCII face isn't shown twice.

## Editing the art

The sprites are drawn in code in `tools/make_sprites.py` (standard library only). Change them
there and run `python3 tools/make_sprites.py`. That rebuilds `assets/*.png`, `assets/preview.png`
and `hooks/sprites.ts`, which holds the PNGs and Raster cells the mod embeds.

## License

MIT. Fan art; not affiliated with Anthropic.
