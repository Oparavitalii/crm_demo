import { useState } from 'react';
import {
  Alert,
  Anchor,
  Autocomplete,
  Button,
  Checkbox,
  Container,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { PublicRecruiterInfo, SubmitPublicCandidateInput } from '@opushr/shared';
import { http, parseApiError } from '@/lib/http';

// Public landing for the per-recruiter application form. Mounted at
// /apply/:slug. If the slug resolves to an active user, we greet the
// candidate by name and tag the submission so it lands in that recruiter's
// view. If the slug is missing or unknown, the form still works — the
// resulting candidate falls into the admin queue for manual triage.

interface FormValues {
  name: string;
  birthDate: Date | null;
  // 2026-06-13 — switched from Select (single canonical code) to Autocomplete
  // (free text + suggestions), so candidates with a nationality not in our
  // status_lookups list can still submit. Whatever they type goes straight to
  // `candidates.nationality` as plain text (free-text column).
  nationality: string;
  phone: string;
  email: string;
  messenger: string;
  experience: string;
  consentAccepted: boolean;
  smsConsentAccepted: boolean;
  emailConsentAccepted: boolean;
}

interface NationalityOption {
  code: string;
  labelPl: string;
  labelUa: string;
}

export function ApplyPage() {
  const { t, i18n } = useTranslation('apply');
  const { slug } = useParams<{ slug: string }>();
  const [submitted, setSubmitted] = useState(false);

  const recruiterQuery = useQuery({
    queryKey: ['public-recruiter', slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async (): Promise<PublicRecruiterInfo | null> => {
      try {
        return await http<PublicRecruiterInfo>(`/public/recruiters/${slug}`);
      } catch {
        // Unknown slug — form still works, just without a personal greeting.
        return null;
      }
    },
  });

  // Nationalities are admin-managed via status-lookups (type=nationality) and
  // surfaced via a dedicated public endpoint. Cache-friendly: the list rarely
  // changes, so the 60s default staleTime is plenty.
  const nationalitiesQuery = useQuery({
    queryKey: ['public-nationalities'],
    queryFn: async (): Promise<NationalityOption[]> => {
      const res = await http<{ items: NationalityOption[] }>('/public/nationalities');
      return res.items;
    },
  });

  // Pick which label column to surface based on the chosen form language.
  // status_lookups only stores PL+UA labels, so we map RU → UA (closer
  // script/loanword overlap) and EN → PL (Latin script). Recruiters never
  // see EN/RU labels — values are stored as the candidate-typed text.
  const lang = i18n.language;
  const useUaLabels = lang.startsWith('ua') || lang.startsWith('uk') || lang.startsWith('ru');
  const nationalitySuggestions =
    nationalitiesQuery.data?.map((n) => (useUaLabels ? n.labelUa : n.labelPl)) ?? [];

  const LANG_OPTIONS = [
    { value: 'ua', label: 'UA' },
    { value: 'pl', label: 'PL' },
    { value: 'ru', label: 'RU' },
    { value: 'en', label: 'EN' },
  ];
  // Map any detected variant (uk-UA, ru-RU, en-US, etc) back to one of our 4
  // codes; default to UA so first-time visitors get a Ukrainian-friendly
  // form (most candidates are UA-speakers).
  const currentLang = (() => {
    if (lang.startsWith('uk') || lang.startsWith('ua')) return 'ua';
    if (lang.startsWith('ru')) return 'ru';
    if (lang.startsWith('en')) return 'en';
    if (lang.startsWith('pl')) return 'pl';
    return 'ua';
  })();

  const form = useForm<FormValues>({
    initialValues: {
      name: '',
      birthDate: null,
      nationality: '',
      phone: '',
      email: '',
      messenger: '',
      experience: '',
      consentAccepted: false,
      smsConsentAccepted: false,
      emailConsentAccepted: false,
    },
    validate: {
      name: (v) => (v.trim().length === 0 ? t('errors.required') : null),
      // Either email or phone must be present — Zod also enforces this on the
      // server. Client-side mirror keeps the UI snappy.
      email: (v, values) =>
        v.trim() === '' && values.phone.trim() === '' ? t('errors.emailOrPhone') : null,
      phone: (v, values) =>
        v.trim() === '' && values.email.trim() === '' ? t('errors.emailOrPhone') : null,
      consentAccepted: (v) => (v === true ? null : t('errors.consentRequired')),
    },
  });

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: SubmitPublicCandidateInput = {
        name: values.name.trim(),
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        birthDate: values.birthDate
          ? values.birthDate.toISOString().slice(0, 10)
          : null,
        nationality: values.nationality.trim() || null,
        messenger: values.messenger.trim() || null,
        experience: values.experience.trim() || null,
        recruiterSlug: slug ?? null,
        consentAccepted: values.consentAccepted,
        smsConsentAccepted: values.smsConsentAccepted,
        emailConsentAccepted: values.emailConsentAccepted,
        source: slug ? 'form_recruiter' : 'website',
      };
      return http<{ id: string }>('/public/candidates', {
        method: 'POST',
        body: payload,
      });
    },
    meta: { errorHandled: true },
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <Container size={560} py={60}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack align="center" gap="md">
            <CircleCheck size={56} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">
              {t('success.title')}
            </Title>
            <Text ta="center" c="dimmed">
              {t('success.body')}
            </Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const recruiter = recruiterQuery.data;
  const recruiterName = recruiter ? `${recruiter.firstName} ${recruiter.lastName}` : null;

  return (
    <Container size={560} py={40}>
      <Stack gap="lg">
        <Stack gap="xs" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" lts={0.5}>
            {t('language')}
          </Text>
          <SegmentedControl
            value={currentLang}
            onChange={(v) => void i18n.changeLanguage(v)}
            data={LANG_OPTIONS}
            size="sm"
          />
        </Stack>

        <Stack gap={4} ta="center">
          <Title order={2}>{t('title')}</Title>
          {recruiterQuery.isFetching && !recruiter ? (
            <Group justify="center" gap="xs">
              <Loader size="xs" />
              <Text c="dimmed" size="sm">{t('loadingRecruiter')}</Text>
            </Group>
          ) : recruiterName ? (
            <Text c="dimmed" size="sm">{t('handledBy', { name: recruiterName })}</Text>
          ) : (
            <Text c="dimmed" size="sm">{t('generalForm')}</Text>
          )}
        </Stack>

        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit((values) => submit.mutate(values))}>
            <Stack>
              <TextInput
                label={t('fields.name')}
                placeholder={t('placeholders.name')}
                withAsterisk
                {...form.getInputProps('name')}
              />
              <DateInput
                label={t('fields.birthDate')}
                placeholder={t('placeholders.birthDate')}
                clearable
                valueFormat="DD.MM.YYYY"
                {...form.getInputProps('birthDate')}
              />
              <Autocomplete
                label={t('fields.nationality')}
                placeholder={t('placeholders.nationality')}
                data={nationalitySuggestions}
                limit={20}
                disabled={nationalitiesQuery.isPending}
                {...form.getInputProps('nationality')}
              />
              <TextInput
                label={t('fields.phone')}
                placeholder={t('placeholders.phone')}
                inputMode="tel"
                {...form.getInputProps('phone')}
              />
              <TextInput
                label={t('fields.email')}
                placeholder={t('placeholders.email')}
                inputMode="email"
                {...form.getInputProps('email')}
              />
              <TextInput
                label={t('fields.messenger')}
                placeholder={t('placeholders.messenger')}
                {...form.getInputProps('messenger')}
              />
              <Textarea
                label={t('fields.experience')}
                placeholder={t('placeholders.experience')}
                autosize
                minRows={3}
                maxRows={8}
                {...form.getInputProps('experience')}
              />

              <Checkbox
                {...form.getInputProps('consentAccepted', { type: 'checkbox' })}
                label={
                  <Text size="sm">
                    {t('consent.prefix')}{' '}
                    <Anchor
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t('consent.linkLabel')}
                    </Anchor>{' '}
                    {t('consent.suffix')}
                  </Text>
                }
              />

              {/* Optional — SMS marketing consent is separate from the required
                  data-processing consent (RODO: consents must be granular).
                  Server records it only when an email is present, since the
                  consents table is keyed on candidate email. */}
              <Checkbox
                {...form.getInputProps('smsConsentAccepted', { type: 'checkbox' })}
                label={<Text size="sm">{t('consent.sms')}</Text>}
              />

              {/* Optional — email marketing consent, separate + granular from the
                  required RODO processing consent and from the SMS opt-in. */}
              <Checkbox
                {...form.getInputProps('emailConsentAccepted', { type: 'checkbox' })}
                label={<Text size="sm">{t('consent.emailMarketing')}</Text>}
              />

              {submit.isError && (
                <Alert icon={<TriangleAlert size={16} />} color="red" variant="light">
                  {parseApiError(submit.error).code === 'TOO_MANY_REQUESTS'
                    ? t('errors.tooMany')
                    : t('errors.generic')}
                </Alert>
              )}

              <Button type="submit" size="md" loading={submit.isPending}>
                {t('submit')}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Container>
  );
}
