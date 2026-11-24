import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import {
  Badge,
  Card,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
  Paper,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsString, useQueryStates } from 'nuqs';
import { CANDIDATE_STATUSES, type CandidateStatus, type Candidate, type ListCandidatesResponse } from '@opushr/shared';
import { useCandidates } from './api';
import { STATUS_COLORS } from './columns';
import { apiFetch, isNetworkError, parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { HireModal } from './HireModal';
import { DismissModal } from './DismissModal';
import { CancelModal } from './CancelModal';
import { QueryErrorState } from '@/components/QueryErrorState';

// ─────────────────────────────────────────────────────────────────────────────
// Draggable card
// ─────────────────────────────────────────────────────────────────────────────

interface KanbanCardProps {
  candidate: Candidate;
}

function KanbanCard({ candidate }: KanbanCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidate.id,
    data: { candidate },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      padding="xs"
      radius="sm"
      withBorder
      onClick={() => navigate(`/candidates/${candidate.id}`)}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm" lineClamp={1}>
          {candidate.name}
        </Text>
        {candidate.recruiterId && (
          <Badge size="xs" variant="dot" color="violet">
            R
          </Badge>
        )}
      </Group>
      {(candidate.source || (candidate.commentsCount ?? 0) > 0) && (
        <Group mt={4} gap="xs" wrap="nowrap">
          {candidate.source && (
            <Badge size="xs" variant="light" color="gray">
              {candidate.source}
            </Badge>
          )}
          {/* 2026-07-10 — comments were invisible on the kanban (client
              report); count comes with the list response, no extra fetch. */}
          {(candidate.commentsCount ?? 0) > 0 && (
            <Group gap={4} wrap="nowrap">
              <MessageSquare size={12} />
              <Text size="xs" c="dimmed">{candidate.commentsCount}</Text>
            </Group>
          )}
        </Group>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Droppable column
// ─────────────────────────────────────────────────────────────────────────────

interface DroppableColumnProps {
  status: CandidateStatus;
  q?: string;
  source?: string;
}

function DroppableColumn({ status, q, source }: DroppableColumnProps) {
  const { t, i18n } = useTranslation('candidates');
  const { data: statusLookup } = useStatusLookup('candidate_status');
  const lookupRow = statusLookup?.find((r) => r.code === status);
  const lookupLabel = lookupRow
    ? i18n.language === 'pl'
      ? lookupRow.labelPl
      : lookupRow.labelUa
    : null;
  const { setNodeRef, isOver } = useDroppable({ id: status });

  const { data, isError, refetch } = useCandidates({
    status,
    q: q || undefined,
    source: (source as Candidate['source']) || undefined,
    page: 1,
    pageSize: 50,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = total > 50;
  const color = STATUS_COLORS[status];

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      radius="md"
      p="sm"
      bg={isOver ? 'blue.0' : undefined}
      style={{
        minWidth: 240,
        maxWidth: 260,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 400,
        transition: 'background 0.15s',
      }}
    >
      <Group mb="sm" justify="space-between">
        <Text fw={700} size="sm">
          {lookupLabel ?? t(`status.${status}`)}
        </Text>
        <Badge color={color} variant="filled" size="sm">
          {total}
        </Badge>
      </Group>

      <Stack gap="xs" style={{ flex: 1 }}>
        {isError && (
          <QueryErrorState
            compact
            message={t('errors.loadFailed')}
            retryLabel={t('errors.retry')}
            onRetry={() => void refetch()}
          />
        )}
        {!isError && items.length === 0 && (
          <Text c="dimmed" size="xs" ta="center" mt="xl">
            {t('kanban.noCards')}
          </Text>
        )}
        {items.map((c) => (
          <KanbanCard key={c.id} candidate={c} />
        ))}
        {hasMore && (
          <Text size="xs" c="dimmed" ta="center" mt="xs">
            {t('kanban.moreRecords', { count: total - 50 })}
          </Text>
        )}
        {isOver && items.length === 0 && (
          <Text size="xs" c="blue" ta="center" mt="xs">
            {t('kanban.dropHere')}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Kanban component
// ─────────────────────────────────────────────────────────────────────────────

export function CandidateKanban() {
  const { t } = useTranslation('candidates');
  const qc = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();

  const [filters] = useQueryStates({
    q: parseAsString.withDefault(''),
    source: parseAsString.withDefault(''),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CandidateStatus }) =>
      apiFetch<Candidate>(`/candidates/${id}`, { method: 'PATCH', body: { status } }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['candidates'] });
      const snapshot = qc.getQueriesData<ListCandidatesResponse>({ queryKey: ['candidates', 'list'] });
      qc.setQueriesData<ListCandidatesResponse>(
        { queryKey: ['candidates', 'list'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((c) => (c.id === id ? { ...c, status } : c)),
          };
        },
      );
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));
      // Append the backend reason (e.g. reason_required) so the user learns
      // WHY the drop bounced; a dead connection gets the full network message.
      const info = parseApiError(err);
      if (isNetworkError(info)) {
        notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        return;
      }
      const reason = (info.meta?.reason as string | undefined) ?? info.code;
      notifications.show({
        color: 'red',
        message: reason
          ? `${t('errors.statusUpdateFailed')} (${reason})`
          : t('errors.statusUpdateFailed'),
      });
    },
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('kanban.statusUpdated') });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  // Lifecycle statuses still route through modals — hire/dismiss need dates
  // for the employment_periods row, cancel offers an optional reason. (Since
  // 2026-07-02 reasons are optional; the modals stay for the dates.)
  const [hireTarget, setHireTarget] = useState<{ candidate: Candidate; mode: 'hire' | 'rehire' } | null>(null);
  const [dismissTarget, setDismissTarget] = useState<Candidate | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Candidate | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const newStatus = over.id as CandidateStatus;
    const candidate = (active.data.current as { candidate: Candidate } | undefined)?.candidate;
    if (!candidate) return;
    if (candidate.status === newStatus) return;
    if (newStatus === 'employed') {
      setHireTarget({ candidate, mode: 'hire' });
      return;
    }
    if (newStatus === 're_employed') {
      setHireTarget({ candidate, mode: 'rehire' });
      return;
    }
    if (newStatus === 'dismissed') {
      setDismissTarget(candidate);
      return;
    }
    if (newStatus === 'cancelled' || newStatus === 'blacklist') {
      setCancelTarget(candidate);
      return;
    }
    update.mutate({ id: candidate.id, status: newStatus });
  }

  return (
    <Stack gap="xs">
      <Title order={3}>{t('kanban.title')}</Title>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <ScrollArea type="auto" pb="md">
          <Group align="flex-start" wrap="nowrap" gap="md">
            {CANDIDATE_STATUSES.map((status) => (
              <DroppableColumn
                key={status}
                status={status}
                q={filters.q}
                source={filters.source}
              />
            ))}
          </Group>
        </ScrollArea>
      </DndContext>
      {hireTarget && (
        <HireModal
          opened
          onClose={() => setHireTarget(null)}
          candidateId={hireTarget.candidate.id}
          mode={hireTarget.mode}
        />
      )}
      {dismissTarget && (
        <DismissModal
          opened
          onClose={() => setDismissTarget(null)}
          candidateId={dismissTarget.id}
        />
      )}
      {cancelTarget && (
        <CancelModal
          opened
          onClose={() => setCancelTarget(null)}
          candidateId={cancelTarget.id}
        />
      )}
    </Stack>
  );
}
