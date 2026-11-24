import { Anchor, Button, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { openDocumentFile, useAcceptDocument, usePendingAcceptances } from './api';
import { MarkdownView } from './MarkdownView';

export function PendingAcceptancesModal() {
  const { t } = useTranslation('documents');
  const { data, isPending } = usePendingAcceptances();
  const accept = useAcceptDocument();

  const items = data?.items ?? [];
  const current = items[0];
  const hasPending = !isPending && items.length > 0;

  return (
    <Modal
      opened={hasPending}
      onClose={() => {
        /* non-dismissible — closes only after final acceptance */
      }}
      withCloseButton={false}
      closeOnEscape={false}
      closeOnClickOutside={false}
      size="lg"
      title={t('pending.title')}
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          {t('pending.subtitle')}
        </Text>
        {current?.document.contentMd && (
          <MarkdownView>{current.document.contentMd}</MarkdownView>
        )}
        {current?.document.fileKey && (
          <Text size="sm">
            <Anchor
              component="button"
              type="button"
              onClick={() => current && void openDocumentFile(current.document.id)}
            >
              {t('actions.openFile')}
            </Anchor>
          </Text>
        )}
        {current && (
          <Button
            loading={accept.isPending}
            onClick={() =>
              accept.mutate({ id: current.document.id, version: current.document.version })
            }
          >
            {t('actions.acceptAndContinue')} ({items.length})
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
