import { Badge } from '@mantine/core';
import type { DataTableColumn } from 'mantine-datatable';
import type { TFunction } from 'i18next';
import type { EnrichedDismissal } from '@crm/shared';

const fullName = (first?: string | null, last?: string | null): string =>
  `${first ?? ''} ${last ?? ''}`.trim() || '—';

interface BuildDismissalColumnsOptions {
  // Maps a source code → localized label (fed from useStatusLookup('sources')).
  sourceLabels?: Map<string, string>;
  // Maps a dismissal_reason code → localized label.
  reasonLabels?: Map<string, string>;
}

// Always-keep accessor whitelist — these never get auto-hidden by
// filterColumnsByData, even if the current page has them all blank.
export const DISMISSAL_ALWAYS_SHOW = ['candidate', 'reason', 'dismissedAt'] as const;

export function buildDismissalColumns(
  t: TFunction<'operations'>,
  opts: BuildDismissalColumnsOptions = {},
): DataTableColumn<EnrichedDismissal>[] {
  return [
    {
      accessor: 'candidate',
      title: t('dismissalsRegistry.fields.candidate'),
      width: 200,
      ellipsis: true,
      render: (d) => d.candidateName ?? '—',
    },
    {
      accessor: 'projectName',
      title: t('dismissalsRegistry.fields.project', { defaultValue: 'Projekt' }),
      width: 180,
      ellipsis: true,
      render: (d) => d.projectName ?? '—',
    },
    {
      accessor: 'recruiter',
      title: t('dismissalsRegistry.fields.recruiter', { defaultValue: 'Rekruter' }),
      width: 180,
      ellipsis: true,
      render: (d) => fullName(d.recruiterFirstName, d.recruiterLastName),
    },
    {
      accessor: 'coordinator',
      title: t('dismissalsRegistry.fields.coordinator', { defaultValue: 'Koordynator' }),
      width: 180,
      ellipsis: true,
      render: (d) => fullName(d.coordinatorFirstName, d.coordinatorLastName),
    },
    {
      accessor: 'daysWorked',
      title: t('dismissalsRegistry.fields.daysWorked', { defaultValue: 'Dni pracy' }),
      width: 110,
      render: (d) => (d.daysWorked != null ? d.daysWorked : '—'),
    },
    {
      accessor: 'candidateSource',
      title: t('dismissalsRegistry.fields.source'),
      width: 140,
      render: (d) =>
        d.candidateSource ? (
          <Badge variant="light" color="blue">
            {opts.sourceLabels?.get(d.candidateSource) ?? d.candidateSource}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      accessor: 'reason',
      title: t('dismissalsRegistry.fields.reason'),
      width: 200,
      ellipsis: true,
      render: (d) => {
        const code = d.reasonCode || d.reason;
        return opts.reasonLabels?.get(code) ?? code ?? '—';
      },
    },
    {
      accessor: 'reasonNote',
      title: t('dismissalsRegistry.fields.reasonNote', { defaultValue: 'Notatka' }),
      width: 220,
      ellipsis: true,
      render: (d) => d.reasonNote ?? '',
    },
    {
      accessor: 'dismissedAt',
      title: t('dismissalsRegistry.fields.dismissedAt'),
      width: 140,
      render: (d) => new Date(d.dismissedAt).toLocaleDateString(),
    },
    {
      accessor: 'recordedBy',
      title: t('dismissalsRegistry.fields.recordedBy'),
      width: 180,
      ellipsis: true,
      render: (d) => fullName(d.recordedByFirstName, d.recordedByLastName),
    },
  ];
}
