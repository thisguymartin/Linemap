import WebSocket from 'ws';
import logger from '../utils/logger.js';
import type { WebSocketMessage } from '../types.js';

export const clients = new Set<WebSocket>();

export function broadcast(message: WebSocketMessage): void {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    } catch {
      logger.warn('Failed to send to client, removing');
      clients.delete(client);
    }
  });
}
