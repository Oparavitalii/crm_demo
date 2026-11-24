import { ActionIcon, Badge, Button, Container, Group, Table, Text, Title } from '@mantine/core';
import { Edit, Trash2, Upload, FileText, Send, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDocuments, useDeleteDocument, usePublishDocument } from './api';

export function AdminDocumentListPage() {
  const { t } = useTranslation('documents');
  const navigate = useNavigate();
  const { data, isPending } = useDocuments({ pageSize: 200 });
  const del = useDeleteDocument();
  const publish = usePublishDocument();

  const items = data?.items ?? [];

  return (
    <Container size="xl">
      <Group justify="space-between" mb="md">
        <Title order={2}>{t('admin.title')}</Title>
        <Group>
          <Button leftSection={<FileText size={16} />} onClick={() => navigate('/admin/documents/new-md')}>
            {t('actions.createMd')}
          </Button>
          <Button
            leftSection={<Upload size={16} />}
            variant="default"
            onClick={() => navigate('/admin/documents/new-file')}
          >
            {t('actions.createFile')}
          </Button>
        </Group>
      </Group>

      {isPending && <Text c="dimmed">…</Text>}

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Slug</Table.Th>
            <Table.Th>Tytuł</Table.Th>
            <Table.Th>Kategoria</Table.Th>
            <Table.Th>v</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Akcje</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((d) => (
            <Table.Tr key={d.id}>
              <Table.Td>
                <code>{d.slug}</code>
              </Table.Td>
              <Table.Td>{d.title}</Table.Td>
              <Table.Td>{t(`categories.${d.category}`)}</Table.Td>
              <Table.Td>{d.version}</Table.Td>
              <Table.Td>
                {d.publishedAt ? (
                  <Badge color="green" variant="light">
                    Opublikowany
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light">
                    Draft
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <ActionIcon variant="subtle" onClick={() => navigate(`/admin/documents/${d.id}/edit`)}>
                    <Edit size={16} />
                  </ActionIcon>
                  {!d.publishedAt && (
                    <ActionIcon variant="subtle" color="green" onClick={() => publish.mutate(d.id)}>
                      <Send size={16} />
                    </ActionIcon>
                  )}
                  {d.requiresAcceptance && (
                    <ActionIcon
                      variant="subtle"
                      onClick={() => navigate(`/admin/documents/${d.id}/acceptances`)}
                    >
                      <Users size={16} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      if (confirm(`Usunąć "${d.title}"?`)) del.mutate(d.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
