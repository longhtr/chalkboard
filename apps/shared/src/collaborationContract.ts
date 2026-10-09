/**
 * Binary message tags shared by every collaboration client and room. Values are
 * protocol bytes and therefore append-only: renumbering changes wire meaning.
 */
/** Yjs document synchronization frame. */
export const COLLABORATION_MESSAGE_SYNC = 0;
/** Ephemeral cursor and presence frame. */
export const COLLABORATION_MESSAGE_AWARENESS = 1;
/** Server confirmation that all updates through a sequence are durable. */
export const COLLABORATION_MESSAGE_ACKNOWLEDGEMENT = 2;
