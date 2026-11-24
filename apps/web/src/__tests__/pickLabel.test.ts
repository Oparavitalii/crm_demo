// pickLabel — pure utility from useStatusLookup.ts.
// Used by every page that renders a status badge / dropdown. Wrong return
// here = wrong label across the entire CRM, so the contract is locked here:
//   - null/undefined/empty code → empty label, missing=false
//   - code not in items → raw code returned, missing=true
//   - code in items → localized label by language ('pl' | 'ua' | other → pl)
import { describe, it, expect } from 'vitest';
import type { StatusLookup } from '@opushr/shared';
import { pickLabel } from '../features/admin-statuses/useStatusLookup';

const baseRow: StatusLookup = {
  id: 'row-1',
  type: 'dismissal_reason',
  code: 'health',
  labelPl: 'Stan zdrowia',
  labelUa: 'Стан здоров\'я',
  groupKey: null,
  sortOrder: 0,
  isSystem: false,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdById: null,
};

describe('pickLabel', () => {
  it('returns empty label for null code (no badge, no warning)', () => {
    expect(pickLabel([baseRow], null, 'pl')).toEqual({ label: '', missing: false });
  });

  it('returns empty label for undefined code', () => {
    expect(pickLabel([baseRow], undefined, 'pl')).toEqual({ label: '', missing: false });
  });

  it('returns empty label for empty-string code', () => {
    expect(pickLabel([baseRow], '', 'pl')).toEqual({ label: '', missing: false });
  });

  it('returns PL label when language is pl', () => {
    expect(pickLabel([baseRow], 'health', 'pl')).toEqual({
      label: 'Stan zdrowia',
      missing: false,
    });
  });

  it('returns UA label when language is ua', () => {
    expect(pickLabel([baseRow], 'health', 'ua')).toEqual({
      label: 'Стан здоров\'я',
      missing: false,
    });
  });

  it('uses UA label for any non-pl language (current behaviour: only pl gets PL, everything else gets UA)', () => {
    // Locked as intentional: i18next emits 'pl' or 'ua' in this app; anything
    // else (en, de) is unsupported and lands on UA. If the language matrix
    // ever changes, update this test together with pickLabel.
    expect(pickLabel([baseRow], 'health', 'en')).toEqual({
      label: 'Стан здоров\'я',
      missing: false,
    });
  });

  it('returns raw code with missing=true when items list does not contain the code (e.g. soft-deleted lookup)', () => {
    // This is the contract that lets soft-deleted statuses still render
    // SOMETHING in old rows — fall back to the raw code rather than ''.
    expect(pickLabel([baseRow], 'gone-from-list', 'pl')).toEqual({
      label: 'gone-from-list',
      missing: true,
    });
  });

  it('returns raw code with missing=true when items is undefined (query still loading)', () => {
    expect(pickLabel(undefined, 'health', 'pl')).toEqual({
      label: 'health',
      missing: true,
    });
  });

  it('returns raw code with missing=true when items is empty array', () => {
    expect(pickLabel([], 'health', 'pl')).toEqual({
      label: 'health',
      missing: true,
    });
  });

  it('picks correct row when multiple rows share the type but differ by code', () => {
    const otherRow: StatusLookup = { ...baseRow, id: 'row-2', code: 'family', labelPl: 'Sprawy rodzinne', labelUa: 'Сімейні справи' };
    expect(pickLabel([baseRow, otherRow], 'family', 'pl')).toEqual({
      label: 'Sprawy rodzinne',
      missing: false,
    });
  });

  it('is case-sensitive on code (matches DB unique constraint)', () => {
    expect(pickLabel([baseRow], 'HEALTH', 'pl')).toEqual({
      label: 'HEALTH',
      missing: true,
    });
  });
});
