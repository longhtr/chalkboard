/** Locks binary collaboration tags so browser and server cannot silently renumber the wire protocol. */
import { describe, expect, it } from 'vitest';

import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_AWARENESS,
  COLLABORATION_MESSAGE_SYNC,
} from './collaborationContract';

describe('collaboration protocol', () => {
  it('keeps the deployed binary message tags stable', () => {
    expect(COLLABORATION_MESSAGE_SYNC).toBe(0);
    expect(COLLABORATION_MESSAGE_AWARENESS).toBe(1);
    expect(COLLABORATION_MESSAGE_ACKNOWLEDGEMENT).toBe(2);
  });
});
