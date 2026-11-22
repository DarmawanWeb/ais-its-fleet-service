import { describe, expect, it } from 'vitest';

import {
  mapLegacySecondaryShip,
  parseRegistryKey,
  planRegistrySearch,
  substringArmNeeded,
} from './registry.js';

describe('parseRegistryKey', () => {
  it('reads 9 digits as an MMSI and 7 digits (optionally IMO…) as an IMO number', () => {
    expect(parseRegistryKey('525005223')).toEqual({
      kind: 'mmsi',
      mmsi: 525005223,
    });
    expect(parseRegistryKey(' 9037941 ')).toEqual({
      kind: 'imo',
      imo: '9037941',
    });
    expect(parseRegistryKey('IMO9037941')).toEqual({
      kind: 'imo',
      imo: '9037941',
    });
    expect(parseRegistryKey('imo 9037941')).toEqual({
      kind: 'imo',
      imo: '9037941',
    });
  });

  it('refuses anything else', () => {
    for (const value of [
      '',
      '52500522',
      '0525005223',
      '012345678',
      'DHARMA',
      '9037941a',
    ]) {
      expect(parseRegistryKey(value), value).toBeUndefined();
    }
  });
});

describe('planRegistrySearch', () => {
  it('matches short names by prefix only and longer ones also by substring', () => {
    expect(planRegistrySearch('Dh')).toEqual({
      text: 'dh',
      digits: undefined,
      imoPrefix: undefined,
      mmsiRange: undefined,
      substring: 'never',
    });
    expect(planRegistrySearch(' Ferry ')).toMatchObject({
      text: 'ferry',
      substring: 'when_sparse',
    });
  });

  it('runs the scanning substring arm only as the match mode allows', () => {
    expect(planRegistrySearch('ferry', 'auto').substring).toBe('when_sparse');
    expect(planRegistrySearch('ferry', 'contains').substring).toBe('always');
    expect(planRegistrySearch('ferry', 'prefix').substring).toBe('never');
    // Too short for a substring even when asked for one.
    expect(planRegistrySearch('fe', 'contains').substring).toBe('never');
  });

  it('turns digit queries into indexed identity lookups without a substring arm', () => {
    expect(planRegistrySearch('5250')).toMatchObject({
      digits: '5250',
      imoPrefix: '5250',
      mmsiRange: [525_000_000, 525_099_999],
      substring: 'never',
    });
    expect(planRegistrySearch('525005223', 'contains')).toMatchObject({
      digits: '525005223',
      imoPrefix: undefined,
      mmsiRange: [525_005_223, 525_005_223],
      substring: 'never',
    });
    expect(planRegistrySearch('IMO 9037941')).toMatchObject({
      digits: '9037941',
      imoPrefix: '9037941',
      substring: 'never',
    });
    // MMSIs never start with 0.
    expect(planRegistrySearch('0123').mmsiRange).toBeUndefined();
  });
});

describe('substringArmNeeded', () => {
  it('adds the substring arm when the indexed arms leave the page short (auto)', () => {
    const plan = planRegistrySearch('dharma');
    expect(substringArmNeeded(plan, 0, 20)).toBe(true);
    expect(substringArmNeeded(plan, 19, 20)).toBe(true);
    expect(substringArmNeeded(plan, 20, 20)).toBe(false);
  });

  it('follows explicit modes and never scans for identity lookups', () => {
    expect(
      substringArmNeeded(planRegistrySearch('dharma', 'contains'), 500, 20),
    ).toBe(true);
    expect(
      substringArmNeeded(planRegistrySearch('dharma', 'prefix'), 0, 20),
    ).toBe(false);
    expect(substringArmNeeded(planRegistrySearch('9037941'), 0, 20)).toBe(
      false,
    );
  });
});

describe('mapLegacySecondaryShip', () => {
  it('parses the legacy string fields', () => {
    const result = mapLegacySecondaryShip({
      _id: { $oid: '683ab0e288e28cca4c61173b' },
      IMO: '9037941',
      MMSI: '525005223',
      NAME: ' DHARMA FERRY VIII ',
      BUILT: '1990',
      FLAG: 'ID',
      FLAGNAME: 'Indonesia',
      TYPE: 'Ro-ro Passenger Ship',
      TYPENAME: 'Ro-ro Passenger Ship',
      GT: '2877',
      DWT: '',
      LOA: '73.3',
      BEAM: '16,3',
      DRAUGHT: '4.1',
      CLASS: 'CLASS',
      CLASSCODE: 'CLASSCODE',
    });
    expect(result).toMatchObject({
      ok: true,
      particulars: {
        imo: '9037941',
        mmsi: 525005223,
        name: 'DHARMA FERRY VIII',
        built: 1990,
        flag: 'ID',
        flagName: 'Indonesia',
        gt: 2877,
        dwt: null,
        loa: 73.3,
        beam: 16.3,
        draught: 4.1,
        class: 'CLASS',
        classCode: 'CLASSCODE',
      },
    });
    if (result.ok)
      expect(result.particulars.raw).toMatchObject({ MMSI: '525005223' });
  });

  it('refuses documents without a valid MMSI or a name', () => {
    expect(mapLegacySecondaryShip({ MMSI: '12345', NAME: 'X' })).toEqual({
      ok: false,
      reason: 'invalid MMSI "12345"',
    });
    expect(mapLegacySecondaryShip({ MMSI: '525005223', NAME: '  ' })).toEqual({
      ok: false,
      reason: 'missing NAME',
    });
  });

  it('keeps unparsable numbers as null and strips an IMO prefix', () => {
    const result = mapLegacySecondaryShip({
      MMSI: '525005223',
      NAME: 'A',
      IMO: 'IMO123456',
      GT: 'n/a',
      BUILT: 'unknown',
    });
    expect(result).toMatchObject({
      ok: true,
      particulars: { imo: '123456', gt: null, built: null },
    });
  });
});
