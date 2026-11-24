import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth-store';

export interface DismissalsExportFilters {
  q?: string;
  source?: string | null;
  reason?: string;
  reasonCode?: string | null;
  projectId?: string | null;
  recruiterId?: string | null;
  coordinatorId?: string | null;
  preset?: string;
  from?: string | null;
  to?: string | null;
}

// Streams the dismissals XLSX export from the API and triggers a browser
// download. Pulls credentials from useAuthStore at call time so it works the
// same regardless of which page mounts it.
export function useExportDismissals() {
  const { t } = useTranslation('operations');
  const [isExporting, setIsExporting] = useState(false);

  async function run(filters: DismissalsExportFilters) {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.source) params.set('source', filters.source);
      if (filters.reason) params.set('reason', filters.reason);
      if (filters.reasonCode) params.set('reasonCode', filters.reasonCode);
      if (filters.projectId) params.set('projectId', filters.projectId);
      if (filters.recruiterId) params.set('recruiterId', filters.recruiterId);
      if (filters.coordinatorId) params.set('coordinatorId', filters.coordinatorId);
      if (filters.preset) params.set('preset', filters.preset);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);

      const token = useAuthStore.getState().accessToken;
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch(
        `${baseURL}/dismissals/export.xlsx${params.toString() ? `?${params.toString()}` : ''}`,
        { method: 'GET', credentials: 'include', headers },
      );
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      // Backend sets X-Row-Count (exposed via CORS) — read before consuming body.
      const rowCountHeader = res.headers.get('X-Row-Count');
      const rowCount = rowCountHeader && /^\d+$/.test(rowCountHeader) ? Number(rowCountHeader) : null;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `dismissals-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      notifications.show({
        color: 'green',
        message:
          rowCount !== null
            ? t('dismissals.exportSuccess', { count: rowCount })
            : t('dismissals.exportSuccessNoCount', { defaultValue: 'Excel pobrany' }),
      });
    } catch {
      notifications.show({ color: 'red', message: t('dismissals.exportError') });
    } finally {
      setIsExporting(false);
    }
  }

  return { run, isExporting };
}
