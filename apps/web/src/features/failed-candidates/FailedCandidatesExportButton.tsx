import { Button } from '@mantine/core';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import { useFailedCandidates } from './api';
import { pickLabel, useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

// CSV export button for the failed-candidates report. Reads the same nuqs
// filter state CandidateList uses so the export reflects what's on screen,
// and shares the same react-query cache (no extra network round-trip).
export function FailedCandidatesExportButton() {
  const { t, i18n } = useTranslation(['failed-candidates', 'candidates']);
  const tCandidates = useTranslation('candidates').t;
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');

  const [filters] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault(''),
    source: parseAsString.withDefault(''),
    position: parseAsString.withDefault(''),
    legalStatus: parseAsString.withDefault(''),
    reconciliationPeriod: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    view: parseAsStringEnum(['list', 'kanban']).withDefault('list'),
    preset: parseAsString.withDefault('all'),
    from: parseAsString,
    to: parseAsString,
    freelancerId: parseAsString,
    projectId: parseAsString,
    recruiterId: parseAsString,
    hasEmail: parseAsBoolean,
    hasPhone: parseAsBoolean,
    duplicatesOnly: parseAsBoolean.withDefault(false),
  });

  const { data } = useFailedCandidates({
    q: filters.q || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
    preset: (filters.preset as never) || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    projectId: filters.projectId || undefined,
    recruiterId: filters.recruiterId || undefined,
  });
  const items = data?.items ?? [];

  function exportCsv() {
    const headers = [
      t('fields.candidate'),
      t('fields.project'),
      t('fields.recruiter'),
      t('fields.coordinator'),
      t('fields.reason'),
      t('fields.status'),
      t('fields.markedAt'),
    ];
    const rows = items.map((c) => [
      c.name ?? '',
      c.projectName ?? '',
      `${c.recruiterFirstName ?? ''} ${c.recruiterLastName ?? ''}`.trim(),
      `${c.coordinatorFirstName ?? ''} ${c.coordinatorLastName ?? ''}`.trim(),
      c.workEndReason
        ? pickLabel(reasonLookup, c.workEndReason, i18n.language).label
        : '',
      tCandidates(`status.${c.status}`),
      new Date(c.updatedAt).toISOString().slice(0, 10),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failed-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="light"
      leftSection={<Download size={16} />}
      onClick={exportCsv}
      disabled={items.length === 0}
    >
      {t('exportCsv')}
    </Button>
  );
}
