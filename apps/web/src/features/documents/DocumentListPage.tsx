import { Badge, Card, Container, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { FileText, FileType, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Document, DocumentCategory } from '@crm/shared';
import { useDocuments, useMyAcceptances } from './api';

const CATEGORY_ORDER: DocumentCategory[] = [
  'regulamin',
  'rodo',
  'procedura',
  'polityka',
  'inne',
];

export function DocumentListPage() {
  const { t } = useTranslation('documents');
  const navigate = useNavigate();
  const { data, isPending } = useDocuments();
  const { data: mine } = useMyAcceptances();

  const items = data?.items ?? [];
  const grouped = new Map<DocumentCategory, Document[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const d of items) grouped.get(d.category)?.push(d);

  const acceptedSet = new Set(
    (mine?.items ?? []).map((a) => `${a.documentId}:${a.version}`),
  );

  return (
    <Container size="xl">
      <Stack gap="xs" mb="md">
        <Title order={2}>{t('title')}</Title>
        <Text c="dimmed">{t('subtitle')}</Text>
      </Stack>

      {isPending && <Text c="dimmed">…</Text>}

      <Stack gap="xl">
        {CATEGORY_ORDER.map((cat) => {
          const docs = grouped.get(cat) ?? [];
          if (docs.length === 0) return null;
          return (
            <Stack key={cat} gap="sm">
              <Title order={4}>{t(`categories.${cat}`)}</Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {docs.map((d) => {
                  const accepted = acceptedSet.has(`${d.id}:${d.version}`);
                  return (
                    <Card
                      key={d.id}
                      shadow="xs"
                      padding="md"
                      withBorder
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/documents/${d.slug}`)}
                    >
                      <Group gap="xs" mb="xs">
                        {d.fileKey ? <FileType size={18} /> : <FileText size={18} />}
                        <Text fw={600}>{d.title}</Text>
                      </Group>
                      <Group gap="xs">
                        <Badge variant="light">{t('list.version', { n: d.version })}</Badge>
                        {d.requiresAcceptance && (
                          <Badge color={accepted ? 'green' : 'orange'} variant="light">
                            {accepted ? (
                              <Group gap={4}>
                                <CheckCircle2 size={12} /> {t('list.accepted')}
                              </Group>
                            ) : (
                              t('list.requiresAcceptance')
                            )}
                          </Badge>
                        )}
                      </Group>
                    </Card>
                  );
                })}
              </SimpleGrid>
            </Stack>
          );
        })}
      </Stack>
    </Container>
  );
}
