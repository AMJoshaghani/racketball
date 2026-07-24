# RacketBall

A fast, 3D paddle-ball arcade game that runs straight in the browser. Carry
the ball, aim your shot, and try not to get scored on. Play locally, vs AI,
or online with a friend.

![game](https://s6.imgcdn.dev/YHcq7V.png)

## Features

- **Local 2-player**, **single-player vs AI** (3 difficulties), or **online
  peer-to-peer** (host/join with a short code, no signup)
- Touch controls on phones/tablets, full keyboard support on desktop
- Ball speed ramps up mid-rally for escalating tension
- No build step. Plain ES modules, loads straight in the browser

## Quick start

```bash
npx serve .
# or: python3 -m http.server 8000
```

Open the printed local address. Needs a real HTTP server (not `file://`), because
browsers block ES module imports and WebRTC from the local filesystem.

## Controls

| | Move | Shoot |
|---|---|---|
| You | `A` `D` | `Space` |
| Player 2 (local mode) | `←` `→` | `Enter` |

Touch controls appear automatically on phones/tablets.

## Tech

[Three.js](https://threejs.org) for rendering, [PeerJS](https://peerjs.com)
for P2P networking, vanilla JS (ES modules) for everything else.

## Cross-network play

Online matches use STUN + TURN (see `js/network.js`) so two players on
different networks can actually connect — STUN alone lets peers behind
compatible NATs punch through directly, but many networks (mobile data,
some routers) can't do that at all and need a TURN relay as fallback.

TURN credentials are fetched fresh from Metered.ca's API each time a
connection is made, rather than hardcoded, since a static username/password
eventually gets rotated or rate-limited server-side. If online matches
start failing to connect, check `METERED_CREDENTIALS_URL` in
`js/network.js` first — the API key embedded there may need rotating from
your [Metered.ca](https://www.metered.ca) dashboard. That key is visible to
anyone who views the page source, which is inherent to fetching credentials
client-side; keep an eye on usage from the dashboard.

Network traffic is deliberately throttled to control bandwidth (and TURN
relay quota, which is metered): the host broadcasts match state at 15Hz
(not every render frame) using a compact array payload instead of a nested
JSON object, and the guest sends input at 20Hz. This cuts total relayed
bytes substantially compared to sending full-frame-rate state, though
WebRTC/TURN protocol overhead (DTLS/SRTP framing, keepalives) means actual
usage won't shrink by the same ratio as the JSON payload size does.

The guest side also smooths incoming positions between network updates
(client-side interpolation) rather than snapping the paddle/ball straight
to each new position — at these rates, snapping produces a visible stutter
between updates, which reads as lag even once bandwidth is under control.
One-shot events (goals, catches, shots) still fire exactly once per actual
network packet, not once per render frame - an earlier version of this
diffing logic accidentally re-compared the same two packets on every
render frame between arrivals, which could re-trigger a goal's sound/
flash/shake several times for a single real event.

## Client-side prediction (guest's own paddle)

Interpolation alone doesn't fix input lag: without prediction, every
keypress on the guest side has to travel guest → host → guest (a full
round trip over the relay) before any movement appears at all - no amount
of smoothing after the fact hides that delay. To fix this, the guest now
runs the *exact same paddle physics* the host uses (`stepPaddlePhysics` in
`js/game.js`, shared by both so they can't drift apart from using
different constants) locally and instantly on every keypress, rather than
waiting for the host to confirm it. The host's confirmed position still
arrives over the network as before and the guest's predicted position is
gently eased toward it every frame (a slow correction, not a snap), so any
small drift from jitter or rounding never accumulates into a lasting
offset, while the immediate keypress response no longer depends on round
trip time at all. This only applies to the guest's own paddle - the
opponent's paddle and the ball are still driven by interpolation, since
those aren't under local control and some network-latency lag there is
unavoidable (and much less noticeable than lag on your own input).

## Desktop-only control hint

The on-screen "A/D to move · Space to shoot" text is only shown on devices
with a real mouse/hover (`@media (hover: hover) and (pointer: fine)` in
`style.css`) - on a touch device the on-screen thumb pad already
communicates the controls, so the text hint is hidden there instead of
cluttering the screen.