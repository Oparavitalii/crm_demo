import { Button, Container, Group, Stack, Text, Title, Badge } from '@mantine/core';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { openDocumentFile, useDocument, useAcceptDocument, useMyAcceptances } from './api';
import { MarkdownView } from './MarkdownView';

export function DocumentDetailPage() {
  const { t } = useTranslation('documents');
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: doc, isPending } = useDocument(slug);
  const { data: mine } = useMyAcceptances();
  const accept = useAcceptDocument();

  if (isPending) return <Container size="md"><Text c="dimmed">…</Text></Container>;
  if (!doc) return <Container size="md"><Text c="red">404</Text></Container>;

  const accepted = (mine?.items ?? []).some(
    (a) => a.documentId === doc.id && a.version === doc.version,
  );

  return (
    <Container size="md">
      <Stack gap="md">
        <Group gap="xs">
          <Badge variant="light">{t(`categories.${doc.category}`)}</Badge>
          <Badge variant="light">{t('list.version', { n: doc.version })}</Badge>
          {doc.requiresAcceptance && (
            <Badge color={accepted ? 'green' : 'orange'} variant="light">
              {accepted ? t('list.accepted') : t('list.requiresAcceptance')}
            </Badge>
          )}
        </Group>
        <Title order={2}>{doc.title}</Title>

        {doc.contentMd && <MarkdownView>{doc.contentMd}</MarkdownView>}
        {doc.fileKey && (
          <Button
            variant="light"
            leftSection={<ExternalLink size={16} />}
            onClick={() => void openDocumentFile(doc.id)}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('actions.openFile')}
          </Button>
        )}

        {doc.requiresAcceptance && !accepted && (
          <Group>
            <Button
              loading={accept.isPending}
              onClick={() =>
                accept.mutate(
                  { id: doc.id, version: doc.version },
                  { onSuccess: () => navigate('/documents') },
                )
              }
            >
              {t('actions.acceptAndContinue')}
            </Button>
          </Group>
        )}
      </Stack>
    </Container>
  );
}
