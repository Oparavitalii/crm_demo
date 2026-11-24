import { useTranslation } from 'react-i18next';
import { formatApiErrorDetail, isNetworkError, parseApiError } from './http';

// One formatter for every "save failed" notification. Distinguishes the three
// failure classes so a user screenshot alone tells us where to look:
//  - browser knows it is offline            → errors:offline
//  - request sent, no response ever arrived → errors:network (their side)
//  - response without a structured code     → generic + "HTTP <status>" (our side)
//  - AppError with code/meta                → generic + "CODE — reason" (validation)
export function useApiErrorMessage() {
  const { t } = useTranslation('errors');
  return (err: unknown): string => {
    const info = parseApiError(err);
    if (isNetworkError(info)) {
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? t('offline')
        : t('network');
    }
    const detail = formatApiErrorDetail(info);
    return detail ? `${t('generic')}: ${detail}` : t('generic');
  };
}
