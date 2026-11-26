import { describe, expect, it } from 'vitest';

import {
  TECHNICAL_SORT_KEYS,
  technicalSortScope,
  VESSEL_SORT_KEYS,
} from './vessel-list.js';

describe('technicalSortScope', () => {
  it('lets platform administrators sort by every vessel’s technical values', () => {
    expect(technicalSortScope({ isPlatformAdmin: true, orgId: null })).toEqual({
      kind: 'all',
    });
    expect(
      technicalSortScope({ isPlatformAdmin: true, orgId: 'org-a' }),
    ).toEqual({ kind: 'all' });
  });

  it('limits everybody else to the vessels of the active organization', () => {
    expect(
      technicalSortScope({ isPlatformAdmin: false, orgId: 'org-a' }),
    ).toEqual({ kind: 'organization', orgId: 'org-a' });
    expect(technicalSortScope({ isPlatformAdmin: false, orgId: null })).toEqual(
      { kind: 'none' },
    );
  });

  it('treats tonnages and the build year as technical, identity as shared (§8.5)', () => {
    expect(
      VESSEL_SORT_KEYS.filter((key) => TECHNICAL_SORT_KEYS.has(key)),
    ).toEqual(['gt', 'dwt', 'builtYear']);
  });
});
