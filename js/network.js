// Thin wrapper around PeerJS. The host runs the authoritative simulation
// and broadcasts state; the guest just sends input and renders whatever
// state it receives. This replaces the old "whoever currently owns the
// ball simulates it" scheme, which was fragile and duplicated logic.

// STUN alone is enough when at least one side's NAT allows direct
// hole-punching (e.g. same Wi-Fi, or a simple/cone NAT). Once both peers
// are on separate networks - different Wi-Fi, mobile data, many home
// routers - direct P2P often isn't possible at all, no matter how long you
// wait, because of symmetric NAT / carrier-grade NAT. A TURN server is a
// relay both sides can always reach, used as the fallback when direct
// connection fails. Without one, cross-network connections fail
// unpredictably.
//
// Metered.ca issues short-lived TURN credentials from this endpoint rather
// than a fixed username/password - a static pair would eventually get
// rotated or rate-limited server-side (which is what caused earlier 401
// "short term auth failed" errors), so credentials are fetched fresh each
// time a connection is made instead of hardcoded here.
const METERED_CREDENTIALS_URL =
  'https://racketball.metered.live/api/v1/turn/credentials?apiKey=81d80827cc38d4da5351fb9f1685d8e5a897';

const FALLBACK_STUN_ONLY = [{ urls: 'stun:stun.relay.metered.ca:80' }];

async function fetchIceServers() {
  try {
    const res = await fetch(METERED_CREDENTIALS_URL);
    if (!res.ok) throw new Error('bad response: ' + res.status);
    const servers = await res.json();
    if (!Array.isArray(servers) || servers.length === 0) throw new Error('empty credential list');
    return servers;
  } catch (err) {
    // Falls back to STUN-only, meaning only same-network / compatible-NAT
    // connections will succeed until the credentials endpoint is reachable
    // again - still better than failing to construct a Peer at all.
    console.warn('Could not fetch TURN credentials, falling back to STUN-only:', err);
    return FALLBACK_STUN_ONLY;
  }
}

export class NetSession {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.onOpenId = null;
    this.onConnected = null;
    this.onData = null;
    this.onClose = null;
    this.onError = null;
  }

  async host() {
    const iceServers = await fetchIceServers();
    return new Promise((resolve, reject) => {
      this.role = 'host';
      this.peer = new Peer({ config: { iceServers } });
      this.peer.on('open', (id) => {
        this.onOpenId && this.onOpenId(id);
        resolve(id);
      });
      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this._wireConn(conn);
      });
      this.peer.on('error', (err) => {
        this.onError && this.onError(err);
        reject(err);
      });
    });
  }

  async join(hostId) {
    const iceServers = await fetchIceServers();
    return new Promise((resolve, reject) => {
      this.role = 'guest';
      this.peer = new Peer({ config: { iceServers } });
      this.peer.on('open', () => {
        const conn = this.peer.connect(hostId, { reliable: true });
        this.conn = conn;
        conn.on('open', () => {
          this._wireConn(conn);
          resolve();
        });
        conn.on('error', (err) => {
          this.onError && this.onError(err);
          reject(err);
        });
      });
      this.peer.on('error', (err) => {
        this.onError && this.onError(err);
        reject(err);
      });
    });
  }

  _wireConn(conn) {
    conn.on('data', (data) => this.onData && this.onData(data));
    conn.on('close', () => this.onClose && this.onClose());
    conn.on('open', () => this.onConnected && this.onConnected());
    // In case 'open' already fired before listeners attached (host side).
    if (conn.open) this.onConnected && this.onConnected();
  }

  send(data) {
    if (this.conn && this.conn.open) this.conn.send(data);
  }

  destroy() {
    try { this.conn && this.conn.close(); } catch (e) {}
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.conn = null;
    this.peer = null;
  }
}
