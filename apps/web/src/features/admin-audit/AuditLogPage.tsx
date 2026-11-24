import { Container, Tabs, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AuditLogTab } from './AuditLogTab';
import { ConsentHistoryTab } from './ConsentHistoryTab';

export function AuditLogPage() {
  const { t } = useTranslation('admin');

  return (
    <Container size="xl">
      <Title order={2} mb="md">{t('auditLog.title')}</Title>

      <Tabs defaultValue="events">
        <Tabs.List mb="md">
          <Tabs.Tab value="events">{t('auditLog.tabs.events')}</Tabs.Tab>
          <Tabs.Tab value="consents">{t('consentHistory.tabTitle')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="events">
          <AuditLogTab />
        </Tabs.Panel>

        <Tabs.Panel value="consents">
          <ConsentHistoryTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
