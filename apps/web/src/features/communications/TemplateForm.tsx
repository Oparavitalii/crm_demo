import { Button, Group, Select, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { RichTextEditor } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useTranslation } from 'react-i18next';
import type { CreateMessageTemplateInput, MessageChannel, MessageTemplate } from '@crm/shared';

interface TemplateFormProps {
  initial?: Partial<MessageTemplate>;
  onSubmit: (values: CreateMessageTemplateInput) => void;
  isPending: boolean;
  onCancel: () => void;
  isEdit?: boolean;
}

// Unicode (UTF-8) SMS limits: first part 70 chars, multi-part 67 chars/part.
// We hard-cap at 3 parts (210 chars after the first part deduction nuance) to
// keep cost predictable. SMSAPI handles the actual segmentation; this is only
// for UX feedback.
const SMS_MAX_PARTS = 3;
const SMS_FIRST_PART_LIMIT = 70;
const SMS_MULTIPART_LIMIT = 67;
const SMS_HARD_LIMIT = SMS_FIRST_PART_LIMIT + (SMS_MAX_PARTS - 1) * SMS_MULTIPART_LIMIT; // 204

function countSmsParts(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  if (len <= SMS_FIRST_PART_LIMIT) return 1;
  return Math.min(
    SMS_MAX_PARTS,
    1 + Math.ceil((len - SMS_FIRST_PART_LIMIT) / SMS_MULTIPART_LIMIT),
  );
}

export function TemplateForm({ initial, onSubmit, isPending, onCancel, isEdit }: TemplateFormProps) {
  const { t } = useTranslation('communications');

  const form = useForm<CreateMessageTemplateInput>({
    initialValues: {
      name: initial?.name ?? '',
      channel: initial?.channel ?? 'email',
      subject: initial?.subject ?? '',
      body: initial?.body ?? '',
      variables: initial?.variables ?? [],
      autoSendOnCreate: initial?.autoSendOnCreate ?? false,
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? 'Required' : null),
      body: (v, values) => {
        if (v.trim().length < 1) return 'Required';
        if (values.channel === 'sms' && v.length > SMS_HARD_LIMIT) {
          return t('templates.form.sms.tooLong');
        }
        return null;
      },
    },
  });

  const editor = useEditor({
    extensions: [StarterKit],
    content: initial?.body ?? '',
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => {
      form.setFieldValue('body', e.getHTML());
    },
  });

  function handleSubmit(values: CreateMessageTemplateInput) {
    // SMS templates can never be the onboarding auto-send (backend forces this
    // too); email templates carry the toggle through as-is.
    if (values.channel === 'sms') {
      onSubmit({ ...values, autoSendOnCreate: false });
      return;
    }
    onSubmit({
      ...values,
      body: editor?.getHTML() ?? values.body,
      autoSendOnCreate: values.autoSendOnCreate ?? false,
    });
  }

  function handleChannelChange(value: string | null) {
    const channel: MessageChannel = value === 'sms' ? 'sms' : 'email';
    form.setFieldValue('channel', channel);
    // Onboarding auto-send only applies to email — clear it when switching to SMS.
    if (channel === 'sms') form.setFieldValue('autoSendOnCreate', false);
  }

  function insertConsentBlock() {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(
        `<p><a href="{{consentConfirmUrl}}">${t('templates.form.consentBlock.linkText')}</a></p>`,
      )
      .run();
    form.setFieldValue('body', editor.getHTML());
  }

  const isSms = form.values.channel === 'sms';
  const smsParts = isSms ? countSmsParts(form.values.body) : 0;
  const smsCharColor = !isSms
    ? undefined
    : form.values.body.length === 0
    ? 'dimmed'
    : form.values.body.length <= SMS_FIRST_PART_LIMIT
    ? 'green'
    : form.values.body.length <= SMS_HARD_LIMIT
    ? 'orange'
    : 'red';

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack>
        <TextInput
          label={t('templates.fields.name')}
          required
          {...form.getInputProps('name')}
        />
        <Select
          label={t('templates.fields.channel')}
          data={[
            { value: 'email', label: t('templates.channel.email') },
            { value: 'sms', label: t('templates.channel.sms') },
          ]}
          required
          {...form.getInputProps('channel')}
          onChange={handleChannelChange}
        />
        {!isSms && (
          <TextInput
            label={t('templates.fields.subject')}
            {...form.getInputProps('subject')}
          />
        )}
        <div>
          <Text size="sm" fw={500} mb={4}>{t('templates.fields.body')} *</Text>
          {isSms ? (
            <Textarea
              minRows={4}
              autosize
              maxLength={SMS_HARD_LIMIT + 50}
              {...form.getInputProps('body')}
            />
          ) : (
            <RichTextEditor editor={editor}>
              <RichTextEditor.Toolbar sticky stickyOffset={60}>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.Bold />
                  <RichTextEditor.Italic />
                  <RichTextEditor.Strikethrough />
                  <RichTextEditor.Code />
                </RichTextEditor.ControlsGroup>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.BulletList />
                  <RichTextEditor.OrderedList />
                </RichTextEditor.ControlsGroup>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.H1 />
                  <RichTextEditor.H2 />
                  <RichTextEditor.H3 />
                </RichTextEditor.ControlsGroup>
              </RichTextEditor.Toolbar>
              <RichTextEditor.Content style={{ minHeight: 200 }} />
            </RichTextEditor>
          )}
          {!isSms && (
            <Button
              variant="light"
              size="xs"
              mt={8}
              onClick={insertConsentBlock}
            >
              {t('templates.form.consentBlock.button')}
            </Button>
          )}
          {form.errors.body && (
            <Text c="red" size="sm" mt={4}>{form.errors.body}</Text>
          )}
          {isSms && (
            <>
              <Text size="xs" c={smsCharColor} mt={4}>
                {t('templates.form.sms.charCount', {
                  count: form.values.body.length,
                  parts: smsParts,
                })}
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                {t('templates.form.sms.optOutHint')}
              </Text>
            </>
          )}
        </div>
        <Text size="xs" c="dimmed">{t('templates.form.variablesHint')}</Text>
        {!isSms && (
          <div>
            <Switch
              label={t('templates.form.autoSend.label')}
              checked={form.values.autoSendOnCreate ?? false}
              onChange={(e) => form.setFieldValue('autoSendOnCreate', e.currentTarget.checked)}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {t('templates.form.autoSend.caption')}
            </Text>
          </div>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onCancel}>{t('templates.form.cancel')}</Button>
          <Button type="submit" loading={isPending}>
            {isEdit ? t('templates.form.submitSave') : t('templates.form.submitCreate')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
