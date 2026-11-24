import { useTranslation } from 'react-i18next';
import { CandidateList } from './CandidateList';

// "Всі" view — no `kind` means no statusBucket is sent to the backend, so the
// list shows the full roster: candidate statuses (new … cancelled) AND client
// statuses (employed … blacklist) together.
export function PeopleListPage() {
  const { t } = useTranslation('candidates');
  return <CandidateList titleOverride={t('list.titleAll')} />;
}
