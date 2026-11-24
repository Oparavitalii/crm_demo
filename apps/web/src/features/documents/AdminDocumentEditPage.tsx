import {
  Button,
  Checkbox,
  Container,
  MultiSelect,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAdminDocument, useUpdateDocument } from './api';

const CATEGORIES = ['regulamin', 'rodo', 'procedura', 'polityka', 'inne'] as const;
const ROLES = ['admin', 'recruiter', 'coordinator', 'readonly'] as const;

export function AdminDocumentEditPage() {
  const { t } = useTranslation('documents');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: doc } = useAdminDocument(id);
  const update = useUpdateDocument(id ?? '');

  const form = useForm({
    initialValues: {
      title: '',
      category: 'regulamin' as (typeof CATEGORIES)[number],
      contentMd: '',
      requiresAcceptance: false,
      visibleToRoles: [...ROLES] as string[],
    },
  });

  useEffect(() => {
    if (doc) {
      form.setValues({
        title: doc.title,
        category: doc.category,
        contentMd: doc.contentMd ?? '',
        requiresAcceptance: doc.requiresAcceptance,
        visibleToRoles: doc.visibleToRoles,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  if (!doc)
    return (
      <Container size="md">
        <Text c="dimmed">…</Text>
      </Container>
    );

  return (
    <Container size="md">
      <Title order={2} mb="md">
        Edytuj: {doc.title}
      </Title>
      {doc.publishedAt && doc.requiresAcceptance && (
        <Text c="orange" size="sm" mb="md">
          Uwaga: zapis spowoduje bump wersji (obecna: {doc.version} → {doc.version + 1}).
          Wszyscy pracownicy będą musieli zaakceptować nową wersję.
        </Text>
      )}
      <form
        onSubmit={form.onSubmit(async (values) => {
          // Failure toast comes from the global MutationCache handler; the
          // try/catch only stops the navigate + kills the unhandled rejection.
          try {
            await update.mutateAsync({
              title: values.title,
              category: values.category,
              requiresAcceptance: values.requiresAcceptance,
              visibleToRoles: values.visibleToRoles as never,
              contentMd: doc.contentMd !== null ? values.contentMd : undefined,
            });
          } catch {
            return;
          }
          navigate('/admin/documents');
        })}
      >
        <Stack>
          <TextInput label={t('admin.form.titleField')} {...form.getInputProps('title')} />
          <Select
            label={t('admin.form.category')}
            data={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
            {...form.getInputProps('category')}
          />
          {doc.contentMd !== null && (
            <Textarea
              label={t('admin.form.contentMd')}
              minRows={12}
              autosize
              {...form.getInputProps('contentMd')}
            />
          )}
          <Checkbox
            label={t('admin.form.requiresAcceptance')}
            {...form.getInputProps('requiresAcceptance', { type: 'checkbox' })}
          />
          <MultiSelect
            label={t('admin.form.visibleToRoles')}
            data={ROLES.map((r) => ({ value: r, label: r }))}
            {...form.getInputProps('visibleToRoles')}
          />
          <Button type="submit" loading={update.isPending}>
            Zapisz
          </Button>
        </Stack>
      </form>
    </Container>
  );
}
