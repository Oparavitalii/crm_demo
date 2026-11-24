import { Group, SegmentedControl, Stack } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useTranslation } from 'react-i18next';

// Re-usable date-range filter for any list page.
//
// 8 presets (today / 7d / 30d / thisMonth / lastMonth / quarter / all / custom).
// When preset === 'custom', a DatePickerInput type="range" is rendered alongside.
//
// State is owned by the parent (typically via nuqs URL state). This component
// is dumb — it just reads `preset/from/to` and calls `onChange` with the new values.
//
// Default preset is 'all' (no filtering) so list pages start unfiltered.

export const DATE_RANGE_PRESETS = [
  'all',
  'today',
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
  'quarter',
  'custom',
] as const;

export type DateRangePresetValue = (typeof DATE_RANGE_PRESETS)[number];

interface Props {
  preset: string | null | undefined;
  from: string | null | undefined;
  to: string | null | undefined;
  onChange: (next: {
    preset: DateRangePresetValue;
    from: string | null;
    to: string | null;
  }) => void;
  // Optional: override label namespace if reusing translation keys from a different
  // module's i18n bundle. Defaults to 'common'.
  i18nNamespace?: string;
}

export function DateRangeFilter({
  preset,
  from,
  to,
  onChange,
  i18nNamespace = 'common',
}: Props) {
  const { t } = useTranslation(i18nNamespace);
  const current = (preset ?? 'all') as DateRangePresetValue;

  const presetOptions = DATE_RANGE_PRESETS.map((p) => ({
    value: p,
    label: t(`dateRange.${p}`, p),
  }));

  const rangeValue: [Date | null, Date | null] = [
    from ? new Date(from) : null,
    to ? new Date(to) : null,
  ];

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <SegmentedControl
          value={current}
          onChange={(v) => {
            const next = v as DateRangePresetValue;
            // Clear from/to when switching away from custom or to a preset
            onChange({
              preset: next,
              from: next === 'custom' ? from ?? null : null,
              to: next === 'custom' ? to ?? null : null,
            });
          }}
          data={presetOptions}
          size="xs"
        />
        {current === 'custom' && (
          <DatePickerInput
            type="range"
            value={rangeValue}
            onChange={([f, t2]) => {
              onChange({
                preset: 'custom',
                from: f ? new Date(f).toISOString() : null,
                to: t2 ? new Date(t2).toISOString() : null,
              });
            }}
            placeholder={t('dateRange.customPlaceholder', 'Wybierz zakres')}
            miw={260}
            clearable
            size="xs"
          />
        )}
      </Group>
    </Stack>
  );
}
