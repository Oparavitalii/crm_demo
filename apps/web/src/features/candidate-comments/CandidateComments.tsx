import { useState } from 'react';
import { ActionIcon, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CandidateComment } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { QueryErrorState } from '@/components/QueryErrorState';
import {
  useCandidateComments,
  useCreateCandidateComment,
  useDeleteCandidateComment,
} from './api';

interface Props {
  candidateId: string;
}

// authorId is NULL for the 127 comments bulk-imported from Excel — label them
// explicitly instead of a cryptic "—".
function authorName(c: CandidateComment, unknownLabel: string, importedLabel: string): string {
  if (!c.authorId) return importedLabel;
  const full = `${c.authorFirstName ?? ''} ${c.authorLastName ?? ''}`.trim();
  return full || unknownLabel;
}

export function CandidateComments({ candidateId }: Props) {
  const { t } = useTranslation(['candidates', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const { data, isPending, isError, refetch } = useCandidateComments(candidateId);
  const create = useCreateCandidateComment(candidateId);
  const del = useDeleteCandidateComment(candidateId);

  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed) {
      setError(t('comments.bodyRequired'));
      return;
    }
    setError(null);
    create.mutate(
      { body: trimmed },
      {
        onSuccess: () => {
          setBody('');
          notifications.show({ color: 'green', message: t('comments.created') });
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  function handleDelete(commentId: string) {
    modals.openConfirmModal({
      title: t('comments.title'),
      children: <Text>{t('comments.deleteConfirm')}</Text>,
      labels: { confirm: t('detail.delete'), cancel: t('form.cancel') },
      confirmProps: { color: 'red', loading: del.isPending },
      onConfirm: () => {
        del.mutate(commentId, {
          onSuccess: () => notifications.show({ color: 'green', message: t('comments.deleted') }),
          onError: (err: unknown) => {
            notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
          },
        });
      },
    });
  }

  const items = data?.items ?? [];

  return (
    <Stack>
      <Paper withBorder p="md" radius="md" shadow="sm">
        <Stack>
          <Textarea
            placeholder={t('comments.placeholder')}
            minRows={3}
            autosize
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            error={error}
          />
          <Group justify="flex-end">
            <Button onClick={handleSubmit} loading={create.isPending} disabled={!body.trim()}>
              {t('comments.submit')}
            </Button>
          </Group>
        </Stack>
      </Paper>

      {isPending && <Text c="dimmed" size="sm">...</Text>}

      {/* 2026-07-10 — a failed load used to render exactly like "no comments",
          which read as "my comments disappeared" (client report). */}
      {isError && (
        <QueryErrorState
          compact
          message={t('errors.loadFailed', { defaultValue: 'Не вдалося завантажити дані' })}
          retryLabel={t('errors.retry', { defaultValue: 'Повторити' })}
          onRetry={() => void refetch()}
        />
      )}

      {!isPending && !isError && items.length === 0 && (
        <Text c="dimmed" size="sm">{t('comments.empty')}</Text>
      )}

      {items.map((c) => {
        const canDelete = isAdmin || (user?.id != null && c.authorId === user.id);
        return (
          <Paper key={c.id} withBorder p="md" radius="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4} style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    {authorName(
                      c,
                      t('comments.unknownAuthor'),
                      t('comments.importedAuthor', { defaultValue: 'Імпортовано' }),
                    )}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {new Date(c.createdAt).toLocaleString()}
                  </Text>
                </Group>
                <Text style={{ whiteSpace: 'pre-wrap' }}>{c.body}</Text>
              </Stack>
              {canDelete && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => handleDelete(c.id)}
                  aria-label={t('detail.delete')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              )}
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
