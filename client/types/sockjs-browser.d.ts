declare module "sockjs-client/dist/sockjs.js" {
  type SockJsInstance = {
    close: () => void;
    send: (message: string) => void;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
  };

  type SockJsConstructor = new (url: string, _reserved?: unknown, options?: { transports?: string[] }) => SockJsInstance;

  const SockJS: SockJsConstructor;
  export default SockJS;
}
