import { Box, Group, Text } from '@mantine/core';

interface LegendItemProps {
  color: string;
  label: string;
  value: number;
  percent: number;
}

export function LegendItem({ color, label, value, percent }: LegendItemProps) {
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Box
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: color,
            flexShrink: 0,
          }}
        />
        <Text size="sm" lineClamp={1}>
          {label}
        </Text>
      </Group>
      <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {value} · {percent}%
      </Text>
    </Group>
  );
}
