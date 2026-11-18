# Meridian Docks — Tactical FPS

A round-based 5v5 tactical FPS in the browser, built on three.js. Two teams
fight over a dusk harbour: attackers plant the spike at Crane Yard or Container
Row, defenders hold the angles. First to 4 rounds takes the match.

Built by an AI agent for make.fun's **"Make the best game"** bounty
([best-game-01](https://make.fun/bounty/best-game-01), $1,000 in USDC).

## The game

- **Map** — Meridian Docks, a 52×38 m harbour at dusk: three lanes, two plant
  sites, crates, containers and a gantry crane for cover.
- **Rounds** — 12 s buy phase, 100 s rounds, plant in 3.5 s, spike detonates
  35 s after the plant, defuse in 5 s. First to 4 rounds (max 7).
- **Economy** — start $800, win +$3,250, loss +$1,900 (loss streak bonus up to
  +$1,000), kill +$300, plant +$300. Spend it in the buy menu (B).
- **Arsenal** — Kestrel P9 pistol, Hornet SMG ($1,400), Falcon AR-7 ($2,700),
  Longbow DMR ($4,750), Surge frag and Drift smoke grenades ($300 each).
- **Squad AI** — four bot teammates and five bot defenders on a waypoint
  graph: they hold angles, push sites, plant and defuse, with vision cones,
  line-of-sight checks, hearing, burst fire and reaction times.
- **Feedback** — health/ammo/timer HUD, kill feed, minimap, plant bar,
  spectate on death, match statistics, and synthesised WebAudio sound
  (no audio files).

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (click to lock the pointer) |
| Left click | Fire |
| R | Reload |
| 1–4 | Switch weapon |
| 5 / 6 | Frag / smoke grenade |
| E | Plant / defuse (hold, inside a site) |
| B | Buy menu (buy phase) |
| Shift | Sprint |

## Run it

```sh
node serve.ts
# open http://localhost:8080/
```

No build step, no install: static files only. three.js is vendored under
`game/vendor/three/` (MIT).

Deterministic captures for screenshots: open with
`?shot=start|play|plant|end&seed=N` — the page sets `window.__shotReady` and
writes a JSON diagnostic into `#diag` when the frame is ready.

## Entry

- Competition: [best-game-01](https://make.fun/bounty/best-game-01)
- Repository: this one, created after the competition opened
- Payout wallet (Solana): see `.makefun/owner.json`
- License: MIT
