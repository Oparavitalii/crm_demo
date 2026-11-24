import { type ReactNode } from 'react';
import { Checkbox, Fieldset, Select, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Local basis value — '' keeps the Select controlled while "no basis picked".
export type ConsentBasis = '' | 'manual_verbal' | 'manual_paper';

interface Props {
  emailAccepted: boolean;
  smsAccepted: boolean;
  basis: ConsentBasis;
  basisError?: ReactNode;
  onEmailChange: (v: boolean) => void;
  onSmsChange: (v: boolean) => void;
  onBasisChange: (v: ConsentBasis) => void;
}

// Create-only block: records that a candidate agreed offline (verbally or on
// paper) to marketing contact. It does NOT send anything — it just captures the
// consent so a later campaign can reach them lawfully. The basis Select appears
// (and is required) only once at least one channel is ticked.
export function CandidateConsentFields({
  emailAccepted,
  smsAccepted,
  basis,
  basisError,
  onEmailChange,
  onSmsChange,
  onBasisChange,
}: Props) {
  const { t } = useTranslation('candidates');
  const anyChecked = emailAccepted || smsAccepted;

  return (
    <Fieldset legend={t('consent.title')}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          {t('consent.caption')}
        </Text>
        <Checkbox
          label={t('consent.email')}
          checked={emailAccepted}
          onChange={(e) => onEmailChange(e.currentTarget.checked)}
        />
        <Checkbox
          label={t('consent.sms')}
          checked={smsAccepted}
          onChange={(e) => onSmsChange(e.currentTarget.checked)}
        />
        {anyChecked && (
          <Select
            label={t('consent.basis')}
            placeholder={t('consent.basisPlaceholder')}
            data={[
              { value: 'manual_verbal', label: t('consent.manual_verbal') },
              { value: 'manual_paper', label: t('consent.manual_paper') },
            ]}
            value={basis || null}
            onChange={(v) => onBasisChange((v as ConsentBasis) ?? '')}
            error={basisError}
            required
          />
        )}
      </Stack>
    </Fieldset>
  );
}
