import { CandidateList } from '@/features/candidates/CandidateList';

// 2026-06-12: `/clients` no longer narrows the backend query — both lists
// show the full 8-status roster so a coordinator can revert a client back to
// a candidate stage from here too. `kind="client"` is kept purely for
// cosmetics (title "Клієнти", "Add client" button label, per-URL
// localStorage keys for hidden columns / widths).
export function ClientListPage() {
  return <CandidateList kind="client" />;
}
