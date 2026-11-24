import { Container, Tabs, Title, Stack } from '@mantine/core';
import { Settings, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { StatusLookupType } from '@crm/shared';
import { StatusLookupTable } from './StatusLookupTable';
import { TrashTab } from './TrashTab';

const TYPES: StatusLookupType[] = [
  'sources',
  'dismissal_reason',
  'no_show_reason',
  // 2026-06-10: user-creatable types added via the inline modal on the
  // candidate form. Surfacing them here so admins can also rename/soft-delete.
  'position',
  'legal_status',
  'nationality',
];

export function StatusManagementPage() {
  const { t } = useTranslation('admin');
  const [active, setActive] = useState<string>('sources');

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Title order={2}>{t('statusLookups.title')}</Title>
        <Tabs value={active} onChange={(v) => v && setActive(v)} keepMounted={false}>
          <Tabs.List>
            {TYPES.map((type) => (
              <Tabs.Tab key={type} value={type} leftSection={<Settings size={14} />}>
                {t(`statusLookups.tabs.${type}`)}
              </Tabs.Tab>
            ))}
            <Tabs.Tab value="trash" leftSection={<Trash2 size={14} />} ml="auto">
              {t('statusLookups.tabs.trash')}
            </Tabs.Tab>
          </Tabs.List>

          {TYPES.map((type) => (
            <Tabs.Panel key={type} value={type} pt="md">
              <StatusLookupTable type={type} />
            </Tabs.Panel>
          ))}
          <Tabs.Panel value="trash" pt="md">
            <TrashTab />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
