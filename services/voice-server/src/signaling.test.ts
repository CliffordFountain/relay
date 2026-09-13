import { describe, it, expect } from 'vitest';
import { guildToAuthorize } from './signaling.js';

describe('guildToAuthorize', () => {
  it('returns the guild id for a normal guild voice channel', () => {
    expect(guildToAuthorize('123456789')).toBe('123456789');
  });

  it('trims surrounding whitespace', () => {
    expect(guildToAuthorize('  42 ')).toBe('42');
  });

  it('coerces a numeric id to its string form', () => {
    expect(guildToAuthorize(42)).toBe('42');
  });

  it('returns null for a DM/group call (empty server_id)', () => {
    expect(guildToAuthorize('')).toBeNull();
    expect(guildToAuthorize('   ')).toBeNull();
  });

  it('returns null when server_id is absent', () => {
    expect(guildToAuthorize(undefined)).toBeNull();
    expect(guildToAuthorize(null)).toBeNull();
  });
});
