import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_STATUSES,
  HOUSING_TYPES,
  candidateStatusSchema,
  housingTypeSchema,
} from '@crm/shared';

describe('shared enum exports', () => {
  it('CANDIDATE_STATUSES mirrors the candidateStatusSchema options', () => {
    expect(CANDIDATE_STATUSES).toEqual(candidateStatusSchema.options);
  });

  it('CANDIDATE_STATUSES preserves the canonical pipeline order', () => {
    expect([...CANDIDATE_STATUSES]).toEqual([
      'new',
      'in_progress',
      'documents_submitted',
      'cancelled',
      'employed',
      're_employed',
      'dismissed',
      'blacklist',
    ]);
  });

  it('HOUSING_TYPES is ["own", "our"] with own first', () => {
    expect([...HOUSING_TYPES]).toEqual(['own', 'our']);
    expect(HOUSING_TYPES).toEqual(housingTypeSchema.options);
  });
});
