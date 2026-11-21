import { describe, expect, it } from 'vitest';

import {
  mapLegacySecondaryShip,
  parseRegistryKey,
  planRegistrySearch,
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
  it('matches short names by prefix only and longer ones by substring', () => {
    expect(planRegistrySearch('Dh')).toEqual({
      namePrefix: 'dh',
      nameContains: undefined,
      imoPrefix: undefined,
      mmsiRange: undefined,
    });
    expect(planRegistrySearch(' Ferry ')).toMatchObject({
      namePrefix: 'ferry',
      nameContains: 'ferry',
    });
  });

  it('turns digit queries into IMO prefixes and MMSI ranges', () => {
    expect(planRegistrySearch('5250')).toMatchObject({
      imoPrefix: '5250',
      mmsiRange: [525_000_000, 525_099_999],
    });
    expect(planRegistrySearch('525005223')).toMatchObject({
      imoPrefix: undefined,
      mmsiRange: [525_005_223, 525_005_223],
    });
    expect(planRegistrySearch('IMO 90379')).toMatchObject({
      imoPrefix: '90379',
    });
    // MMSIs never start with 0.
    expect(planRegistrySearch('0123').mmsiRange).toBeUndefined();
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
