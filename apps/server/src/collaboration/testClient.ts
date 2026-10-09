/**
 * Binary protocol client shared by collaboration tests. It performs real Yjs
 * sync and durable-ack tracking while exposing deterministic waits and teardown
 * instead of duplicating frame parsing in each suite.
 */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_AWARENESS,
  COLLABORATION_MESSAGE_SYNC,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket, type ClientOptions, type RawData } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * A real protocol peer used by gateway tests. Keeping the handshake here lets
 * each test describe policy behavior instead of repeating Yjs wire details.
 */
export class CollaborationTestClient {
  readonly acknowledgementSequences: number[] = [];
  awarenessMessages = 0;
  readonly document = new Y.Doc();
  readonly socket: WebSocket;
  private synchronized = false;
  private synchronize!: () => void;
  private readonly synchronization = new Promise<void>((resolve) => {
    this.synchronize = resolve;
  });

  constructor(url: string, options: ClientOptions = {}) {
    this.socket = new WebSocket(url, options);
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      if (
        origin === this.socket ||
        this.socket.readyState !== this.socket.OPEN
      ) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    });
    this.socket.on('message', (data) => {
      const decoder = decoding.createDecoder(bytes(data));
      const type = decoding.readVarUint(decoder);
      if (type === COLLABORATION_MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.document,
          this.socket,
        );
        if (encoding.length(encoder) > 1) {
          this.socket.send(encoding.toUint8Array(encoder));
        }
        if (!this.synchronized) {
          this.synchronized = true;
          this.synchronize();
        }
      } else if (type === COLLABORATION_MESSAGE_AWARENESS) {
        decoding.readVarUint8Array(decoder);
        this.awarenessMessages += 1;
      } else if (type === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
        const sequence = decoding.readVarUint(decoder);
        const previous = this.acknowledgementSequences.at(-1);
        if (previous !== undefined && sequence <= previous) {
          throw new Error(
            'Collaboration acknowledgements arrived out of order',
          );
        }
        this.acknowledgementSequences.push(sequence);
      }
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState !== this.socket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        this.socket.once('open', resolve);
        this.socket.once('error', reject);
      });
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.document);
    this.socket.send(encoding.toUint8Array(encoder));
    await this.synchronization;
  }

  sendRaw(message: Uint8Array): void {
    this.socket.send(message);
  }

  sendAwareness(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  insert(value: string): void {
    const text = this.document.getText('test');
    text.insert(text.length, value);
  }

  text(): string {
    return this.document.getText('test').toString();
  }

  waitForClose(): Promise<number> {
    if (this.socket.readyState === this.socket.CLOSED)
      return Promise.resolve(0);
    return new Promise<number>((resolve) =>
      this.socket.once('close', (code) => resolve(code)),
    );
  }

  destroy(): void {
    this.document.destroy();
  }

  async close(): Promise<void> {
    if (this.socket.readyState !== this.socket.CLOSED) {
      const closed = this.waitForClose();
      this.socket.close(1000, 'Test complete');
      await closed;
    }
    this.destroy();
  }
}
