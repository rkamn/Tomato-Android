import { API_URL } from './api';
import type { LiveTrackingData } from './LiveRouteTracker';

export function resolveWebSocketUrl(token?: string): string {
  const wsBase = API_URL.replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:')
    .replace(/\/+$/, '');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${wsBase}/ws${query}`;
}

type OrderTrackingListener = (data: LiveTrackingData) => void;
type GlobalOrderTrackingListener = (orderId: string, data: LiveTrackingData) => void;

class TomatoLiveWebSocketService {
  private socket: WebSocket | null = null;
  private token: string = '';
  private orderSubscriptions = new Map<string, Set<OrderTrackingListener>>();
  private globalOrderListeners = new Set<GlobalOrderTrackingListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private shouldConnect = false;

  public connect(token?: string) {
    if (token) this.token = token;
    this.shouldConnect = true;

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      if (this.token && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'auth', token: this.token });
      }
      return;
    }

    const url = resolveWebSocketUrl(this.token);

    try {
      this.socket = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.token) {
        this.send({ type: 'auth', token: this.token });
      }

      // Re-subscribe all active order listeners
      for (const orderId of this.orderSubscriptions.keys()) {
        this.send({ type: 'subscribe_order', orderId });
      }

      this.startPing();
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'order_live_tracking' && msg.orderId && msg.tracking) {
          const cleanId = String(msg.orderId);
          this.globalOrderListeners.forEach((callback) => {
            try {
              callback(cleanId, msg.tracking);
            } catch (_) {}
          });
          const listeners = this.orderSubscriptions.get(cleanId);
          if (listeners) {
            listeners.forEach((callback) => {
              try {
                callback(msg.tracking);
              } catch (_) {}
            });
          }
        }
      } catch (_) {}
    };

    this.socket.onerror = () => {
      this.scheduleReconnect();
    };

    this.socket.onclose = () => {
      this.stopPing();
      this.scheduleReconnect();
    };
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, 25000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.shouldConnect) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) {
        this.connect();
      }
    }, delay);
  }

  public send(payload: Record<string, unknown>) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(payload));
      } catch (_) {}
    }
  }

  public subscribeOrder(
    orderId: string,
    onUpdate: OrderTrackingListener,
  ): () => void {
    if (!orderId) return () => {};

    const cleanId = String(orderId).trim();
    if (!this.orderSubscriptions.has(cleanId)) {
      this.orderSubscriptions.set(cleanId, new Set());
    }
    this.orderSubscriptions.get(cleanId)!.add(onUpdate);

    // Ensure connection is established
    this.connect();

    // If socket is already open, request order subscription immediately
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe_order', orderId: cleanId });
    }

    return () => {
      const listeners = this.orderSubscriptions.get(cleanId);
      if (listeners) {
        listeners.delete(onUpdate);
        if (listeners.size === 0) {
          this.orderSubscriptions.delete(cleanId);
          this.send({ type: 'unsubscribe_order', orderId: cleanId });
        }
      }
    };
  }

  public onOrderUpdate(listener: GlobalOrderTrackingListener): () => void {
    this.globalOrderListeners.add(listener);
    this.connect();
    return () => {
      this.globalOrderListeners.delete(listener);
    };
  }

  public sendRiderLocation(args: {
    lat: number;
    lng: number;
    phone?: string;
    isOnline?: boolean;
    speed?: number;
    heading?: number;
  }) {
    this.connect();
    this.send({
      type: 'rider_location_ping',
      lat: args.lat,
      lng: args.lng,
      phone: args.phone,
      isOnline: args.isOnline ?? true,
      speed: args.speed ?? 0,
      heading: args.heading ?? 0,
    });
  }

  public sendCustomerLocation(args: {
    orderId: string;
    lat: number;
    lng: number;
  }) {
    this.connect();
    this.send({
      type: 'customer_share_location',
      orderId: args.orderId,
      lat: args.lat,
      lng: args.lng,
    });
  }

  public isConnected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  public disconnect() {
    this.shouldConnect = false;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_) {}
      this.socket = null;
    }
    this.orderSubscriptions.clear();
    this.globalOrderListeners.clear();
  }
}

export const tomatoWs = new TomatoLiveWebSocketService();
