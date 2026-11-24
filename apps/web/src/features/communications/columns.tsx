import { Badge, Group } from '@mantine/core';
import type { MessageTemplate, MessageChannel } from '@opushr/shared';
import type { TFunction } from 'i18next';

const CHANNEL_COLORS: Record<MessageChannel, string> = {
  email: 'blue',
  sms: 'green',
};

export function buildTemplateColumns(t: TFunction<'communications'>) {
  return [
    {
      accessor: 'name',
      title: t('templates.fields.name'),
    },
    {
      accessor: 'channel',
      title: t('templates.fields.channel'),
      render: (tmpl: MessageTemplate) => (
        <Group gap="xs">
          <Badge color={CHANNEL_COLORS[tmpl.channel]} variant="light">
            {t(`templates.channel.${tmpl.channel}`)}
          </Badge>
          {tmpl.autoSendOnCreate && (
            <Badge color="grape" variant="light">
              {t('templates.badge.onboarding')}
            </Badge>
          )}
        </Group>
      ),
    },
    {
      accessor: 'subject',
      title: t('templates.fields.subject'),
      render: (tmpl: MessageTemplate) => tmpl.subject ?? '—',
    },
    {
      accessor: 'createdAt',
      title: t('templates.fields.createdAt'),
      render: (tmpl: MessageTemplate) => new Date(tmpl.createdAt).toLocaleDateString(),
    },
  ];
}

export { CHANNEL_COLORS };
