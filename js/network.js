// Thin wrapper around PeerJS. The host runs the authoritative simulation
// and broadcasts state; the guest just sends input and renders whatever
// state it receives. This replaces the old "whoever currently owns the
// ball simulates it" scheme, which was fragile and duplicated logic.

const ICE_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

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

  host() {
    return new Promise((resolve, reject) => {
      this.role = 'host';
      this.peer = new Peer({ config: { iceServers: ICE_SERVERS } });
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

  join(hostId) {
    return new Promise((resolve, reject) => {
      this.role = 'guest';
      this.peer = new Peer({ config: { iceServers: ICE_SERVERS } });
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
