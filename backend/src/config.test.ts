import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './config/index.js';

describe('parseCliArgs', () => {
  it('maps --key value pairs to schema keys', () => {
    expect(parseCliArgs(['--port', '4123', '--runtime', '/tmp/splash'])).toEqual({
      port: 4123,
      runtime: '/tmp/splash',
    });
  });

  it('supports --key=value', () => {
    expect(parseCliArgs(['--port=5000', '--runtime=/srv/splash'])).toEqual({
      port: 5000,
      runtime: '/srv/splash',
    });
  });

  it('ignores positional arguments and supports flags without values', () => {
    expect(parseCliArgs(['serve', '--runtime'])).toEqual({ runtime: '' });
  });
});
