import { describe, expect, it } from 'vitest';

import {
  ownerOfNewVessel,
  ownsVessel,
  type TenantPrincipal,
  vesselViewFor,
} from './vessel-access.js';

const ORG_A = '01980000-0000-7000-8000-0000000000a1';
const ORG_B = '01980000-0000-7000-8000-0000000000b2';

const member = (orgId: string | null): TenantPrincipal => ({
  orgId,
  isPlatformAdmin: false,
});
const admin = (orgId: string | null = null): TenantPrincipal => ({
  orgId,
  isPlatformAdmin: true,
});

describe('vesselViewFor (spec §8.5 DTO selection)', () => {
  it('gives the owning organization the detail view', () => {
    expect(vesselViewFor(member(ORG_A), { orgId: ORG_A })).toBe('detail');
    expect(ownsVessel(member(ORG_A), { orgId: ORG_A })).toBe(true);
  });

  it('gives other organizations (authority, viewers of other tenants) the summary view', () => {
    expect(vesselViewFor(member(ORG_B), { orgId: ORG_A })).toBe('summary');
    expect(vesselViewFor(member(null), { orgId: ORG_A })).toBe('summary');
  });

  it('never treats a platform-owned vessel as owned by a member', () => {
    expect(vesselViewFor(member(ORG_A), { orgId: null })).toBe('summary');
    expect(vesselViewFor(member(null), { orgId: null })).toBe('summary');
  });

  it('gives platform administrators the detail view of every vessel', () => {
    expect(vesselViewFor(admin(), { orgId: ORG_A })).toBe('detail');
    expect(vesselViewFor(admin(ORG_B), { orgId: null })).toBe('detail');
  });
});

describe('ownerOfNewVessel', () => {
  it('uses the active organization of members', () => {
    expect(ownerOfNewVessel(member(ORG_A), undefined)).toEqual({
      allowed: true,
      orgId: ORG_A,
    });
    expect(ownerOfNewVessel(member(ORG_A), ORG_A)).toEqual({
      allowed: true,
      orgId: ORG_A,
    });
  });

  it('refuses another organization and members without one', () => {
    expect(ownerOfNewVessel(member(ORG_A), ORG_B)).toEqual({
      allowed: false,
      reason: 'foreign_organization',
    });
    expect(ownerOfNewVessel(member(null), undefined)).toEqual({
      allowed: false,
      reason: 'organization_required',
    });
  });

  it('lets platform administrators choose any organization or none', () => {
    expect(ownerOfNewVessel(admin(ORG_A), ORG_B)).toEqual({
      allowed: true,
      orgId: ORG_B,
    });
    expect(ownerOfNewVessel(admin(ORG_A), undefined)).toEqual({
      allowed: true,
      orgId: ORG_A,
    });
    expect(ownerOfNewVessel(admin(null), undefined)).toEqual({
      allowed: true,
      orgId: null,
    });
  });
});
