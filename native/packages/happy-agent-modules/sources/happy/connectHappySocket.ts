import { io } from "socket.io-client";

import type { HappySocket } from "./HappySessionClient.js";

/**
 * Opens the Socket.IO connection Happy speaks over.
 *
 * Happy's server is a Socket.IO server, so there is nothing to decide here and nothing for a caller
 * to supply: this module talks to Happy, and this is how Happy is talked to. A client takes a
 * factory only so a test can hand it a socket it can drive by hand.
 */
export function connectHappySocket(url: string, options: Record<string, unknown>): HappySocket {
    return io(url, options) as unknown as HappySocket;
}
