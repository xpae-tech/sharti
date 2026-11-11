import { describe, expect, it } from 'vitest';
import { statusLabel } from './plugins.js';

describe('statusLabel', () => {
  it('maps MCP server statuses to display labels', () => {
    expect(statusLabel('disabled')).toBe('Disabled');
    expect(statusLabel('active')).toBe('Active');
    expect(statusLabel('inactive')).toBe('Inactive');
  });
});
