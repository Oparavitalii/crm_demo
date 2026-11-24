import { Card, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

interface KpiTileProps {
  title: string;
  value: number | string;
  delta?: string;
  icon?: ReactNode;
}

export function KpiTile({ title, value, delta, icon }: KpiTileProps) {
  return (
    <Card
      withBorder
      radius="md"
      padding="lg"
      shadow="sm"
      className="hover-lift"
      data-reveal
    >
      <Group justify="space-between" align="flex-start" mb="xs" wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.4}>
          {title}
        </Text>
        {icon && <Text c="dimmed">{icon}</Text>}
      </Group>
      <Text fz={32} fw={700} lh={1.1} mt={4}>
        {value}
      </Text>
      {delta && (
        <Text size="xs" c="dimmed" mt={6}>
          {delta}
        </Text>
      )}
    </Card>
  );
}
