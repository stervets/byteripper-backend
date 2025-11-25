import { WebSocketServer } from 'ws';
import { safeStringify, timeout } from './common/utils';
import { EvmService } from './evm/evm.service';

const startupTime = Date.now();

class WS {
  private ws: WebSocketServer;
  private evm: EvmService;

  init(server: any, evmService: EvmService) {
    this.evm = evmService;
    this.ws = new WebSocketServer({
      server,
      path: '/ws',
    });
    this.ws.on('connection', this.onSocketConnection.bind(this));
  }

  onSocketConnection(socket: WebSocket) {
    console.log('Socket connected');
    console.log('WebSocket connected');

    socket.onclose = () => {
      console.log(' Socket disconnected');
    };

    socket.onmessage = async (msg) => {
      let com: string;
      let args: any[];
      let id: string;

      try {
        [com, args, id] = JSON.parse(msg.data);
      } catch {
        //console.warn('WS invalid JSON', msg.data);
        return;
      }

      if (this.handlers[com]) {
        const result = await this.handlers[com].apply(this, args);
        id && this.broadcast(JSON.stringify(['[res]', result, id]));
      } else {
        console.warn(`[WS] Handler not found: "${com}"`);
      }
    };

    if (Date.now() - startupTime < 1000) {
      this.send('reloadPage');
    } else {
      socket.send(safeStringify(['updateEnvironment', [this.evm.env]]));
    }
  }

  private broadcast(json: string) {
    this.ws.clients.forEach((c) => c.readyState === 1 && c.send(json));
  }

  send(com: string, ...args: any[]) {
    this.broadcast(JSON.stringify([com, args]));
  }

  handlers: any = {
    async test(a: number, b: number) {
      await timeout(500);
      return a + b;
    },
  };
}

export const ws = new WS();
