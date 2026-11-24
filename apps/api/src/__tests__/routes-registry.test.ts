import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Candidate, ListCandidatesResponse, RouteDescriptor } from '@crm/shared';
import { routes } from '@crm/shared';

describe('routes registry — candidates module', () => {
  it('static descriptors hold the right path + method', () => {
    expect(routes.candidates.list.path).toBe('/candidates');
    expect(routes.candidates.list.method).toBe('GET');
    expect(routes.candidates.create.path).toBe('/candidates');
    expect(routes.candidates.create.method).toBe('POST');
  });

  it('dynamic-param descriptors interpolate ids correctly', () => {
    const detail = routes.candidates.detail('abc-123');
    expect(detail.path).toBe('/candidates/abc-123');
    expect(detail.method).toBe('GET');

    expect(routes.candidates.update('abc-123').method).toBe('PATCH');
    expect(routes.candidates.remove('abc-123').method).toBe('DELETE');
    expect(routes.candidates.hire('abc-123').path).toBe('/candidates/abc-123/hire');
    expect(routes.candidates.rehire('abc-123').path).toBe('/candidates/abc-123/rehire');
    expect(routes.candidates.dismiss('abc-123').path).toBe('/candidates/abc-123/dismiss');
    expect(routes.candidates.cancel('abc-123').path).toBe('/candidates/abc-123/cancel');
    expect(routes.candidates.employmentPeriods('abc-123').path).toBe(
      '/candidates/abc-123/employment-periods',
    );
    expect(routes.candidates.duplicates('abc-123').path).toBe(
      '/candidates/abc-123/duplicates',
    );
  });

  it('admin candidate routes target the /admin namespace', () => {
    expect(routes.adminCandidates.anonymize('id-1').path).toBe(
      '/admin/candidates/id-1/anonymize',
    );
    expect(routes.adminCandidates.anonymize('id-1').method).toBe('POST');
    expect(routes.adminCandidates.exportCandidate('id-1').path).toBe(
      '/admin/candidates/id-1/export',
    );
  });

  it('infers response type from the descriptor at the type level', () => {
    expectTypeOf(routes.candidates.list).toMatchTypeOf<
      RouteDescriptor<ListCandidatesResponse>
    >();
    expectTypeOf(routes.candidates.detail('x')).toMatchTypeOf<
      RouteDescriptor<Candidate>
    >();
  });
});
