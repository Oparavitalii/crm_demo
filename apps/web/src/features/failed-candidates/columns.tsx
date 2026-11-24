import { Badge } from '@mantine/core';
import type { DataTableColumn } from 'mantine-datatable';
import type { TFunction } from 'i18next';
import type { Candidate } from '@crm/shared';
import { STATUS_COLORS } from '@/features/candidates/columns';

const fullName = (first?: string | null, last?: string | null): string =>
  `${first ?? ''} ${last ?? ''}`.trim() || '—';

interface BuildFailedCandidateColumnsOptions {
  // Maps `dismissal_reason` code → localized label (work_end_reason uses the
  // same lookup pool).
  reasonLabels?: Map<string, string>;
}

// Always-keep accessor whitelist — these never get auto-hidden by
// filterColumnsByData.
export const FAILED_CANDIDATE_ALWAYS_SHOW = ['candidate', 'workEndReason'] as const;

export function buildFailedCandidateColumns(
  t: TFunction<'failed-candidates'>,
  tCandidates: TFunction<'candidates'>,
  opts: BuildFailedCandidateColumnsOptions = {},
): DataTableColumn<Candidate>[] {
  return [
    {
      accessor: 'candidate',
      title: t('fields.candidate'),
      width: 200,
      ellipsis: true,
      render: (c) => c.name || '—',
    },
    {
      accessor: 'projectName',
      title: t('fields.project'),
      width: 180,
      ellipsis: true,
      render: (c) => c.projectName ?? '—',
    },
    {
      accessor: 'recruiter',
      title: t('fields.recruiter'),
      width: 180,
      ellipsis: true,
      render: (c) => fullName(c.recruiterFirstName, c.recruiterLastName),
    },
    {
      accessor: 'coordinator',
      title: t('fields.coordinator'),
      width: 180,
      ellipsis: true,
      render: (c) => fullName(c.coordinatorFirstName, c.coordinatorLastName),
    },
    {
      accessor: 'workEndReason',
      title: t('fields.reason'),
      width: 220,
      ellipsis: true,
      render: (c) =>
        c.workEndReason ? (
          <Badge variant="light" color="orange">
            {opts.reasonLabels?.get(c.workEndReason) ?? c.workEndReason}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      accessor: 'status',
      title: t('fields.status'),
      width: 140,
      render: (c) => (
        <Badge color={STATUS_COLORS[c.status]} variant="light">
          {tCandidates(`status.${c.status}`)}
        </Badge>
      ),
    },
    {
      accessor: 'updatedAt',
      title: t('fields.markedAt'),
      width: 140,
      render: (c) => new Date(c.updatedAt).toLocaleDateString(),
    },
  ];
}
