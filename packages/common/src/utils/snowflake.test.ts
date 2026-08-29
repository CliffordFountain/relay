import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSnowflake,
  snowflakeToTimestamp,
  snowflakeToDate,
  snowflakeWorkerId,
  snowflakeProcessId,
  snowflakeIncrement,
  compareSnowflakes,
  isValidSnowflake,
  configureSnowflake,
} from './snowflake';

describe('Snowflake', () => {
  beforeEach(() => {
    configureSnowflake(1, 0);
  });

  describe('generateSnowflake', () => {
    it('returns a string', () => {
      const id = generateSnowflake();
      expect(typeof id).toBe('string');
    });

    it('returns a numeric string', () => {
      const id = generateSnowflake();
      expect(/^\d+$/.test(id)).toBe(true);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateSnowflake());
      }
      expect(ids.size).toBe(1000);
    });

    it('generates IDs in ascending order', () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(generateSnowflake());
      }
      for (let i = 1; i < ids.length; i++) {
        expect(BigInt(ids[i]!)).toBeGreaterThanOrEqual(BigInt(ids[i - 1]!));
      }
    });
  });

  describe('snowflakeToTimestamp', () => {
    it('extracts timestamp within reasonable range', () => {
      const id = generateSnowflake();
      const ts = snowflakeToTimestamp(id);
      const now = Date.now();
      expect(ts).toBeGreaterThan(now - 1000);
      expect(ts).toBeLessThanOrEqual(now + 100);
    });
  });

  describe('snowflakeToDate', () => {
    it('returns a valid Date', () => {
      const id = generateSnowflake();
      const date = snowflakeToDate(id);
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBeGreaterThanOrEqual(2025);
    });
  });

  describe('snowflakeWorkerId', () => {
    it('extracts configured worker ID', () => {
      configureSnowflake(5, 3);
      const id = generateSnowflake();
      expect(snowflakeWorkerId(id)).toBe(5);
    });
  });

  describe('snowflakeProcessId', () => {
    it('extracts configured process ID', () => {
      configureSnowflake(5, 3);
      const id = generateSnowflake();
      expect(snowflakeProcessId(id)).toBe(3);
    });
  });

  describe('snowflakeIncrement', () => {
    it('returns a non-negative number', () => {
      const id = generateSnowflake();
      expect(snowflakeIncrement(id)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compareSnowflakes', () => {
    it('returns negative when a < b', () => {
      const a = generateSnowflake();
      const b = generateSnowflake();
      expect(compareSnowflakes(a, b)).toBeLessThan(0);
    });

    it('returns 0 for equal IDs', () => {
      const a = generateSnowflake();
      expect(compareSnowflakes(a, a)).toBe(0);
    });

    it('returns positive when a > b', () => {
      const a = generateSnowflake();
      const b = generateSnowflake();
      expect(compareSnowflakes(b, a)).toBeGreaterThan(0);
    });
  });

  describe('isValidSnowflake', () => {
    it('returns true for valid snowflakes', () => {
      const id = generateSnowflake();
      expect(isValidSnowflake(id)).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isValidSnowflake('')).toBe(false);
    });

    it('returns false for non-numeric string', () => {
      expect(isValidSnowflake('abc')).toBe(false);
    });

    it('returns false for zero', () => {
      expect(isValidSnowflake('0')).toBe(false);
    });

    it('returns false for negative', () => {
      expect(isValidSnowflake('-123')).toBe(false);
    });
  });

  describe('configureSnowflake', () => {
    it('throws for worker ID out of range', () => {
      expect(() => configureSnowflake(32, 0)).toThrow();
      expect(() => configureSnowflake(-1, 0)).toThrow();
    });

    it('throws for process ID out of range', () => {
      expect(() => configureSnowflake(0, 32)).toThrow();
      expect(() => configureSnowflake(0, -1)).toThrow();
    });
  });
});
