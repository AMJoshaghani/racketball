# RacketBall

A fast, 3D paddle-ball arcade game that runs straight in the browser. Carry
the ball, aim your shot, and try not to get scored on. Play locally, vs AI,
or online with a friend.

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