import { describe, expect, it } from 'vitest';
import { PMAI_MCP_TOOLS } from './pmaiMcpTools';

describe('PMAI MCP tool surface', () => {
  it('contains exactly the five approved PMAI skill families', () => {
    expect(PMAI_MCP_TOOLS.map(([tool, family]) => ({ tool, family }))).toEqual([
      { tool: 'pmai_guide', family: 'pmai-guide' },
      { tool: 'pmai_crm', family: 'pmai-crm' },
      { tool: 'pmai_luma', family: 'pmai-luma' },
      { tool: 'pmai_discord', family: 'pmai-discord' },
      { tool: 'pmai_canva', family: 'pmai-canva' },
    ]);
  });
});
