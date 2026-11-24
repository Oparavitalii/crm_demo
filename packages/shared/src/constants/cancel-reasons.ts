// 2026-06-01 status-model rework. Canonical cancellation reasons.
//
// Picked when status moves to 'cancelled' or 'blacklist'. The 'blacklist' code
// is special — choosing it auto-routes the candidate to status='blacklist'
// instead of 'cancelled'. This keeps the UX to a single "[Відмінити]" button
// without forcing the recruiter to pick the right status manually.
//
// Codes are stable identifiers used in analytics (`GROUP BY cancel_reason_code`).
// Labels are short — fit the table cell. Long labels become tooltips in UI.

import type { CancelReasonCode } from '../schemas/candidate';

export const CANCEL_REASONS = [
  'no_show_lost_contact',
  'personal_reasons',
  'bad_conditions',
  'client_closed_position',
  'legalization_rejected',
  'legal_employment_issue',
  'blacklist',
  'other',
] as const satisfies readonly CancelReasonCode[];

// Codes that move the candidate to status='blacklist'. All others go to 'cancelled'.
export const BLACKLIST_REASONS: ReadonlySet<CancelReasonCode> = new Set([
  'blacklist',
]);

// Labels are colocated for type safety. UI reads via these maps; i18n key
// pattern `cancelReason.${code}.short` / `.long` overrides per locale.
export const CANCEL_REASON_LABELS: Record<
  CancelReasonCode,
  { short: { ua: string; pl: string }; long: { ua: string; pl: string } }
> = {
  no_show_lost_contact: {
    short: { ua: 'Не доїхав, зник', pl: 'Nie dotarł, brak kontaktu' },
    long: {
      ua: 'Не доїхав і втрачено зв’язок',
      pl: 'Nie dotarł i utracono kontakt',
    },
  },
  personal_reasons: {
    short: { ua: 'Особисті обставини', pl: 'Powody osobiste' },
    long: {
      ua: 'Передумав через особисті обставини',
      pl: 'Zmienił zdanie z powodów osobistych',
    },
  },
  bad_conditions: {
    short: { ua: 'Не підійшли умови', pl: 'Niedopasowane warunki' },
    long: {
      ua: 'Передумав через невідповідні умови роботи',
      pl: 'Zmienił zdanie z powodu niedopasowanych warunków pracy',
    },
  },
  client_closed_position: {
    short: { ua: 'Замовник закрив позицію', pl: 'Klient zamknął pozycję' },
    long: {
      ua: 'Заказчик знайшов кандидата без нас або вже не має потреби',
      pl: 'Klient znalazł kandydata bez nas lub nie ma już potrzeby',
    },
  },
  legalization_rejected: {
    short: { ua: 'Відхилила легалізація', pl: 'Odrzucone przez legalizację' },
    long: {
      ua: 'Забракував відділ легалізації',
      pl: 'Odrzucone przez dział legalizacji',
    },
  },
  legal_employment_issue: {
    short: { ua: 'Проблеми з документами', pl: 'Problemy z dokumentami' },
    long: {
      ua: 'Проблема з легальним працевлаштуванням',
      pl: 'Problem z legalnym zatrudnieniem',
    },
  },
  blacklist: {
    short: { ua: 'Чорний список', pl: 'Czarna lista' },
    long: {
      ua: 'Вносимо до чорного списку',
      pl: 'Dodajemy do czarnej listy',
    },
  },
  other: {
    short: { ua: 'Інше', pl: 'Inne' },
    long: { ua: 'Інша причина (вкажіть)', pl: 'Inny powód (wskaż)' },
  },
};
