import {
  Button,
  Checkbox,
  Container,
  FileInput,
  MultiSelect,
  Select,
  Stack,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCreateMarkdownDocument, useCreateFileDocument } from './api';

const CATEGORIES = ['regulamin', 'rodo', 'procedura', 'polityka', 'inne'] as const;
const ROLES = ['admin', 'recruiter', 'coordinator', 'readonly'] as const;

export function AdminDocumentCreatePage() {
  const { t } = useTranslation('documents');
  const navigate = useNavigate();
  const location = useLocation();
  const kind: 'md' | 'file' = location.pathname.endsWith('new-file') ? 'file' : 'md';
  const createMd = useCreateMarkdownDocument();
  const createFile = useCreateFileDocument();

  const form = useForm<{
    slug: string;
    title: string;
    category: (typeof CATEGORIES)[number];
    contentMd: string;
    file: File | null;
    requiresAcceptance: boolean;
    visibleToRoles: string[];
  }>({
    initialValues: {
      slug: '',
      title: '',
      category: 'regulamin',
      contentMd: '',
      file: null,
      requiresAcceptance: false,
      visibleToRoles: [...ROLES],
    },
  });

  return (
    <Container size="md">
      <Title order={2} mb="md">
        {t(`actions.${kind === 'file' ? 'createFile' : 'createMd'}`)}
      </Title>
      <form
        onSubmit={form.onSubmit(async (values) => {
          // Failure toast comes from the global MutationCache handler; the
          // try/catch only stops the navigate + kills the unhandled rejection.
          try {
            if (kind === 'file') {
              if (!values.file) return;
              await createFile.mutateAsync({
                meta: {
                  slug: values.slug,
                  title: values.title,
                  category: values.category,
                  requiresAcceptance: values.requiresAcceptance,
                  visibleToRoles: values.visibleToRoles,
                },
                file: values.file,
              });
            } else {
              await createMd.mutateAsync({
                slug: values.slug,
                title: values.title,
                category: values.category,
                contentMd: values.contentMd,
                requiresAcceptance: values.requiresAcceptance,
                visibleToRoles: values.visibleToRoles as never,
              });
            }
          } catch {
            return;
          }
          navigate('/admin/documents');
        })}
      >
        <Stack>
          <TextInput
            label={t('admin.form.slug')}
            description={t('admin.form.slugHelp')}
            required
            {...form.getInputProps('slug')}
          />
          <TextInput label={t('admin.form.titleField')} required {...form.getInputProps('title')} />
          <Select
            label={t('admin.form.category')}
            data={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
            required
            {...form.getInputProps('category')}
          />
          {kind === 'file' ? (
            <FileInput
              label={t('admin.form.file')}
              accept="application/pdf"
              required
              {...form.getInputProps('file')}
            />
          ) : (
            <Textarea
              label={t('admin.form.contentMd')}
              minRows={12}
              autosize
              required
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
          <Button type="submit" loading={createMd.isPending || createFile.isPending}>
            Zapisz
          </Button>
        </Stack>
      </form>
    </Container>
  );
}
