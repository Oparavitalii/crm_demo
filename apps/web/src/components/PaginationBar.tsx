import { ActionIcon, Button, Group, NumberInput, Popover, Text } from '@mantine/core';
import { usePagination } from '@mantine/hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export function PaginationBar({ page, pageSize, total, onChange }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const { range } = usePagination({ total: totalPages, page, onChange, siblings: 1, boundaries: 1 });

  if (total <= 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <Group justify="space-between" px="md" py="xs" gap="sm" wrap="wrap">
      <Text size="sm" c="dimmed">
        {from} - {to} / {total}
      </Text>
      <Group gap={4} wrap="nowrap">
        <ActionIcon
          variant="default"
          size="md"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="previous page"
        >
          <ChevronLeft size={14} />
        </ActionIcon>
        {range.map((item, idx) =>
          item === 'dots' ? (
            <DotsJumper key={`dots-${idx}`} totalPages={totalPages} onJump={onChange} />
          ) : (
            <ActionIcon
              key={item}
              variant={item === page ? 'filled' : 'default'}
              size="md"
              onClick={() => onChange(item)}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </ActionIcon>
          ),
        )}
        <ActionIcon
          variant="default"
          size="md"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="next page"
        >
          <ChevronRight size={14} />
        </ActionIcon>
      </Group>
    </Group>
  );
}

function DotsJumper({ totalPages, onJump }: { totalPages: number; onJump: (p: number) => void }) {
  const { t } = useTranslation('common');
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState<number | string>('');

  function go() {
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      onJump(n);
      setOpened(false);
      setValue('');
    }
  }

  return (
    <Popover opened={opened} onChange={setOpened} position="top" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <ActionIcon
          variant="default"
          size="md"
          onClick={() => setOpened((o) => !o)}
          aria-label={t('pagination.jumpTo')}
          title={t('pagination.jumpTo')}
        >
          …
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Group gap="xs" wrap="nowrap" align="center">
          <Text size="xs" c="dimmed">
            {t('pagination.jumpTo')}
          </Text>
          <NumberInput
            size="xs"
            value={value}
            onChange={setValue}
            min={1}
            max={totalPages}
            hideControls
            w={70}
            placeholder={`1–${totalPages}`}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
            }}
          />
          <Button size="xs" onClick={go}>
            {t('pagination.go')}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
