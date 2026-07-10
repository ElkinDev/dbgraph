import { describe, expect, it } from 'vitest';
import { DBGRAPH_VERSION } from '../src/index.js';

describe('scaffold', () => {
  it('exposes the version placeholder', () => {
    expect(DBGRAPH_VERSION).toBe('1.1.0');
  });
});
