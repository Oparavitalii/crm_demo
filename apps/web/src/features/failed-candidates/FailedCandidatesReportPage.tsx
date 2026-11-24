import { useTranslation } from 'react-i18next';
import { CandidateList } from '@/features/candidates/CandidateList';
import { FailedCandidatesExportButton } from './FailedCandidatesExportButton';

// 2026-06-11: the bespoke failed-candidates report was replaced by
// `<CandidateList reportSource="failed-candidates">` so this page now reuses
// the exact same DataTable, filters, mobile cards and column-visibility logic
// as /candidates and /clients. Only the data source (and the read-only nature
// of the page) differs — the CandidateList internally swaps `useCandidates`
// for `useFailedCandidates` when `reportSource` is set.
export function FailedCandidatesReportPage() {
  const { t } = useTranslation('failed-candidates');
  return (
    <CandidateList
      reportSource="failed-candidates"
      titleOverride={t('title')}
      extraToolbarSlot={<FailedCandidatesExportButton />}
    />
  );
}
