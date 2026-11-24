import { Button, Stack, Text } from '@mantine/core';

// Rendered instead of list/kanban content when a query is in error state.
// Without it a failed load looks identical to "no records" — users (and the
// client) read that as "my data disappeared" instead of retrying.
interface QueryErrorStateProps {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  compact?: boolean;
}

export function QueryErrorState({ message, retryLabel, onRetry, compact }: QueryErrorStateProps) {
  return (
    <Stack align="center" gap="xs" py={compact ? 'md' : 'xl'}>
      <Text c="red" size={compact ? 'xs' : 'sm'} ta="center">
        {message}
      </Text>
      <Button size={compact ? 'compact-xs' : 'xs'} variant="light" color="red" onClick={onRetry}>
        {retryLabel}
      </Button>
    </Stack>
  );
}
