import SockJS from "sockjs-client/dist/sockjs.js";

type ConnectionHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onMessages?: (messages: unknown) => void;
};

export class AcquireNetworkClient {
  private socket: { close: () => void; send: (message: string) => void } | null = null;

  public constructor(private readonly serverUrl: string, private readonly handlers: ConnectionHandlers) {}

  public connect(username: string, passwordHash: string, version: string) {
    if (this.socket !== null) {
      return;
    }

    const socket = new SockJS(`${this.serverUrl}/sockjs`, undefined, { transports: ["websocket"] });
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify([version, username, passwordHash]));
      this.handlers.onOpen?.();
    };

    socket.onclose = () => {
      this.socket = null;
      this.handlers.onClose?.();
    };

    socket.onmessage = (event: MessageEvent) => {
      this.handlers.onMessages?.(JSON.parse(event.data));
    };
  }

  public disconnect() {
    this.socket?.close();
    this.socket = null;
  }

  public send(...message: unknown[]) {
    this.socket?.send(JSON.stringify(message));
  }
}
