/**
 * Snowflake ID generator and utilities, matching the gateway protocol.
 *
 * Snowflake format (64 bits):
 *   bits 63-22: milliseconds since the Snowflake epoch (2015-01-01T00:00:00.000Z) = 42 bits
 *   bits 21-17: internal worker ID = 5 bits
 *   bits 16-12: internal process ID = 5 bits
 *   bits 11-0:  increment per process = 12 bits
 */

/** Snowflake epoch: 2015-01-01T00:00:00.000Z in milliseconds */
const SNOWFLAKE_EPOCH = 1420070400000n;

let workerIdBits = 1n;
let processIdBits = 0n;
let increment = 0n;
let lastTimestamp = -1n;

/**
 * Configure the Snowflake generator.
 * Call this once at startup if you need custom worker/process IDs.
 */
export const configureSnowflake = (workerId: number, processId: number): void => {
  if (workerId < 0 || workerId > 31) {
    throw new Error('Worker ID must be between 0 and 31');
  }
  if (processId < 0 || processId > 31) {
    throw new Error('Process ID must be between 0 and 31');
  }
  workerIdBits = BigInt(workerId);
  processIdBits = BigInt(processId);
};

/**
 * Generate a new Snowflake ID.
 * Returns the ID as a string (JS cannot safely handle 64-bit integers as numbers).
 */
export const generateSnowflake = (): string => {
  let now = BigInt(Date.now());

  if (now === lastTimestamp) {
    increment = (increment + 1n) & 0xFFFn; // 12-bit wrap
    if (increment === 0n) {
      // Exhausted increment space for this millisecond, wait for next ms
      while (now <= lastTimestamp) {
        now = BigInt(Date.now());
      }
    }
  } else {
    increment = 0n;
  }

  lastTimestamp = now;

  const timestamp = now - SNOWFLAKE_EPOCH;

  const snowflake =
    (timestamp << 22n) |
    (workerIdBits << 17n) |
    (processIdBits << 12n) |
    increment;

  return snowflake.toString();
};

/**
 * Extract the timestamp from a Snowflake ID.
 * Returns the Unix timestamp in milliseconds.
 */
export const snowflakeToTimestamp = (snowflake: string): number => {
  const id = BigInt(snowflake);
  const timestamp = (id >> 22n) + SNOWFLAKE_EPOCH;
  return Number(timestamp);
};

/**
 * Extract the Date from a Snowflake ID.
 */
export const snowflakeToDate = (snowflake: string): Date => {
  return new Date(snowflakeToTimestamp(snowflake));
};

/**
 * Extract the worker ID from a Snowflake ID.
 */
export const snowflakeWorkerId = (snowflake: string): number => {
  const id = BigInt(snowflake);
  return Number((id >> 17n) & 0x1Fn);
};

/**
 * Extract the process ID from a Snowflake ID.
 */
export const snowflakeProcessId = (snowflake: string): number => {
  const id = BigInt(snowflake);
  return Number((id >> 12n) & 0x1Fn);
};

/**
 * Extract the increment from a Snowflake ID.
 */
export const snowflakeIncrement = (snowflake: string): number => {
  const id = BigInt(snowflake);
  return Number(id & 0xFFFn);
};

/**
 * Compare two Snowflake IDs chronologically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export const compareSnowflakes = (a: string, b: string): number => {
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
};

/**
 * Check if a string is a valid Snowflake ID.
 */
export const isValidSnowflake = (value: string): boolean => {
  if (!/^\d+$/.test(value)) return false;
  try {
    const id = BigInt(value);
    return id > 0n && id < (1n << 64n);
  } catch {
    return false;
  }
};
