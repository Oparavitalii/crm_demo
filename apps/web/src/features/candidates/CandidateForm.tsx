import { useMemo, type ReactNode } from 'react';
import { Button, Group, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import {
  CANDIDATE_STATUSES,
  type CandidateStatus,
  type CreateCandidateInput,
  type HousingType,
  type UpdateCandidateInput,
} from '@crm/shared';
import { ProjectSelect } from '@/features/projects/ProjectSelect';
import { useDirectoryUsers } from '@/features/directory/api';
import { useAuthStore } from '@/lib/auth-store';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { LookupSelect } from '@/features/admin-statuses/LookupSelect';
import { hiddenFieldsForRole } from './roleFieldVisibility';
import { CandidateConsentFields, type ConsentBasis } from './CandidateConsentFields';

interface Props {
  initial?: Partial<CreateCandidateInput>;
  // `values` is the full payload (create needs it); `changed` holds only the
  // fields that differ from `initial` — edit pages PATCH with `changed` so
  // untouched legacy values that predate today's validation (imported phones,
  // placeholder emails) are never re-sent and can't fail the whole save.
  onSubmit: (values: CreateCandidateInput, changed: UpdateCandidateInput) => void;
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
}

// Local form shape — date fields are Date | null in UI, ISO strings on submit.
//
// 2026-06-12: backend schema migration 0045 unified `first_name + last_name`
// into a single `name` column. The form still uses `fullName` internally
// (purely cosmetic — same shape), but pre-fill and submit now map 1:1 to
// the unified `name` field on the API side. No split/join required.
interface FormValues {
  fullName: string;
  email: string;
  phone: string;
  birthDate: Date | null;
  nationality: string;
  workStartDate: Date | null;
  workEndDate: Date | null;
  workEndReason: string;
  reasonNote: string;
  status: CandidateStatus;
  // 'our' = agency housing, 'own' = private housing. Required once the
  // candidate transitions to work stage (employed/dismissed/etc.) per product
  // spec — empty when still in pre-work pipeline.
  housingType: HousingType | '';
  projectId: string | null;
  coordinatorId: string | null;
  // Empty string (not null) keeps the LookupSelect controlled.
  source: string;
  notes: string;
  // F3: recruiter that owns this candidate. Empty string means "not picked yet"
  // — Select stays controlled. For recruiter actor we pre-fill with self.id and
  // hide the field (service coerces it anyway). For admin we require a pick.
  recruiterId: string;
  // 2026-06-10 Excel-import prep fields. `position` and `legalStatus` resolve
  // to a code from status_lookups (LookupSelect) — empty string when unset to
  // keep the Select controlled. The other two are free text.
  position: string;
  legalStatus: string;
  reconciliationPeriod: string;
  // 2026-06-10 Block 7 — month-end reconciliation badges + timestamps.
  // All LookupSelect-driven (status_lookups types work_outcome /
  // payout_status / payment_status / retention) except the two dates.
  documentsSubmittedAt: Date | null;
  arrivedAt: Date | null;
  workOutcome: string;
  payoutStatus: string;
  paymentStatus: string;
  retention: string;
  // 2026-06-12 — free-text messenger contact (TG/WA/Viber). Single TextInput,
  // recruiter types whatever the candidate gave them.
  messenger: string;
  // 2026-06-12 — free-text work history. Rendered as autosizing Textarea.
  experience: string;
  // 2026-07-14 — create-only offline-consent capture (see CandidateConsentFields).
  // Never sent on update; kept in form state so the create payload can carry them.
  emailConsentAccepted: boolean;
  smsConsentAccepted: boolean;
  consentBasis: ConsentBasis;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Wraps a pair (or more) of inputs in a Group grow on desktop and a vertical
// Stack on mobile so each input gets full width on a phone. Desktop output
// is identical to the original markup. Defined at module scope so its
// component identity stays stable across CandidateForm re-renders — otherwise
// React unmounts/remounts the subtree on every keystroke and inputs lose focus.
function Row({
  isMobile,
  align,
  children,
}: {
  isMobile: boolean;
  align?: 'flex-end';
  children: ReactNode;
}) {
  return isMobile ? (
    <Stack gap="sm">{children}</Stack>
  ) : (
    <Group grow align={align}>
      {children}
    </Group>
  );
}

export function CandidateForm({ initial, onSubmit, submitting, submitLabel, onCancel }: Props) {
  const { t, i18n } = useTranslation('candidates');
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'admin';
  // 2026-07-08 — role-scoped fields (see roleFieldVisibility.ts): who can't see
  // a field can't edit it either. Hidden inputs keep their initial values, so
  // submit passes them through unchanged — no data loss on save.
  const hiddenFields = hiddenFieldsForRole(currentUser?.role);
  // Consent capture is create-only: a consent is a point-in-time act, not an
  // editable attribute. The edit page always passes `initial`, the create page
  // never does — so `initial === undefined` cleanly distinguishes the two.
  const isCreate = initial === undefined;
  const isMobile = useIsMobile();
  const { data: statusLookup } = useStatusLookup('candidate_status');
  const statusLabel = (code: string) => {
    const row = statusLookup?.find((r) => r.code === code);
    if (row) return i18n.language === 'pl' ? row.labelPl : row.labelUa;
    return t(`status.${code}`, { defaultValue: code });
  };
  // Coordinators + admins are both eligible to manage clients. We opt into
  // `includeInactive` so the full roster shows up — deactivated users are
  // marked with "(неактивний)" so the picker stays informed.
  const { data: directoryData } = useDirectoryUsers({ includeInactive: true });
  const directoryItems = directoryData?.items ?? [];
  const inactiveBadge = t('directory.inactive', { defaultValue: ' (неактивний)' });
  const buildLabel = (u: { firstName: string; lastName: string; isActive: boolean }): string => {
    const name = `${u.firstName} ${u.lastName}`.trim();
    return u.isActive ? name : `${name}${inactiveBadge}`;
  };
  // Show every user that has ever been a coordinator or admin — active rows
  // first, inactive after. Admins routinely act as coordinators in this CRM.
  const coordinatorOptions = directoryItems
    .filter((u) => u.role === 'coordinator' || u.role === 'admin')
    .slice()
    .sort((a, b) => Number(b.isActive) - Number(a.isActive))
    .map((u) => ({ value: u.id, label: buildLabel(u) }));
  // F3: admins can assign the candidate to any recruiter (or admin, since
  // admins routinely act as recruiters in this codebase). We now include
  // deactivated rows too so an admin can reassign a candidate back to the
  // person who originally owned them. Recruiters never see this — their
  // candidates are always owned by them.
  const recruiterOptions = directoryItems
    .filter((u) => u.role === 'recruiter' || u.role === 'admin')
    .slice()
    .sort((a, b) => Number(b.isActive) - Number(a.isActive))
    .map((u) => ({ value: u.id, label: buildLabel(u) }));

  // F3: pick a sensible default for recruiterId.
  // - edit mode (initial.recruiterId present): keep as-is
  // - recruiter actor on create: prefill with self (service coerces anyway)
  // - admin actor on create: leave empty, force conscious pick
  const defaultRecruiterId =
    initial?.recruiterId ??
    (currentUser && currentUser.role === 'recruiter' ? currentUser.id : '');

  // 2026-06-12: the unified `name` column maps 1:1 to the form's `fullName`
  // input — no first/last split anymore.
  // Memoize so the object identity stays stable across re-renders triggered by
  // sibling hooks (useDirectoryUsers, useStatusLookup). Even though Mantine's
  // useForm only consumes initialValues on first mount via useState, keeping
  // the object stable is defensive against any future change and avoids a
  // class of subtle "errors get cleared on next render" bugs.
  const initialValues = useMemo<FormValues>(
    () => ({
      fullName: initial?.name ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      birthDate: parseDate(initial?.birthDate),
      nationality: initial?.nationality ?? '',
      workStartDate: parseDate(initial?.workStartDate),
      workEndDate: parseDate(initial?.workEndDate),
      workEndReason: initial?.workEndReason ?? '',
      reasonNote: initial?.reasonNote ?? '',
      status: initial?.status ?? 'new',
      housingType: (initial?.housingType as HousingType | undefined) ?? '',
      projectId: initial?.projectId ?? null,
      coordinatorId: initial?.coordinatorId ?? null,
      source: initial?.source ?? '',
      notes: initial?.notes ?? '',
      recruiterId: defaultRecruiterId,
      position: initial?.position ?? '',
      legalStatus: initial?.legalStatus ?? '',
      reconciliationPeriod: initial?.reconciliationPeriod ?? '',
      documentsSubmittedAt: parseDate(initial?.documentsSubmittedAt),
      arrivedAt: parseDate(initial?.arrivedAt),
      workOutcome: initial?.workOutcome ?? '',
      payoutStatus: initial?.payoutStatus ?? '',
      paymentStatus: initial?.paymentStatus ?? '',
      retention: initial?.retention ?? '',
      messenger: initial?.messenger ?? '',
      experience: initial?.experience ?? '',
      emailConsentAccepted: false,
      smsConsentAccepted: false,
      consentBasis: '',
    }),
    // Only re-init when the candidate identity itself changes (edit mode
    // swap). Re-runs on create flow only at mount because initial is undefined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial?.name, defaultRecruiterId],
  );

  const form = useForm<FormValues>({
    initialValues,
    // 2026-07-02 — per client request the ONLY obligatory field is the full
    // name; every other input (source, housing, reasons, dates) is
    // independent and optional. The old source/housing requirements kept
    // blocking saves on legacy rows and read as "the Save button is broken".
    validate: {
      fullName: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return t('errors.fullNameInvalid');
        return null;
      },
      // Basis is required once a consent channel is ticked (create-only).
      consentBasis: (value, values) =>
        isCreate && (values.emailConsentAccepted || values.smsConsentAccepted) && !value
          ? t('consent.basisRequired')
          : null,
    },
  });

  // Forward-only status auto-advance triggered by the date pickers introduced
  // in Block 7. Picking a milestone date implies the candidate already passed
  // that stage — so we bump the status forward but never roll it back. Returns
  // the (possibly advanced) status to use in the submit payload.
  // 2026-07-02 — the housing/reason gates were removed together with the
  // backend guards: a work-start date bumps to employed and a work-end date
  // bumps to dismissed regardless of the other fields.
  function syncStatus(values: FormValues): CandidateStatus {
    const rank: Record<CandidateStatus, number> = {
      new: 0,
      in_progress: 1,
      documents_submitted: 2,
      cancelled: 3,
      employed: 4,
      re_employed: 5,
      dismissed: 6,
      blacklist: 7,
    };
    let next = values.status;
    const bump = (to: CandidateStatus) => {
      if (rank[to] > rank[next]) next = to;
    };
    if (values.arrivedAt) bump('in_progress');
    if (values.documentsSubmittedAt) bump('documents_submitted');
    if (values.workStartDate) bump('employed');
    if (values.workEndDate) bump('dismissed');
    return next;
  }

  function buildPayload(values: FormValues, status: CandidateStatus): CreateCandidateInput {
    const payload: CreateCandidateInput = {
      // recruiterId comes from the recruiter Select (admin) or from the
      // pre-filled current user id (recruiter). Empty string → null so backend
      // Zod (idSchema.nullish()) accepts it as "unassigned".
      recruiterId: values.recruiterId || null,
      name: values.fullName.trim(),
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      birthDate: toIsoDate(values.birthDate),
      nationality: values.nationality.trim() || null,
      workStartDate: values.workStartDate ? values.workStartDate.toISOString() : null,
      workEndDate: values.workEndDate ? values.workEndDate.toISOString() : null,
      workEndReason: values.workEndReason.trim() || null,
      reasonNote: values.reasonNote.trim() || null,
      status,
      housingType: values.housingType || null,
      projectId: values.projectId || null,
      coordinatorId: values.coordinatorId || null,
      source: values.source.trim() || null,
      notes: values.notes.trim() || null,
      position: values.position.trim() || null,
      legalStatus: values.legalStatus.trim() || null,
      reconciliationPeriod: values.reconciliationPeriod.trim() || null,
      documentsSubmittedAt: values.documentsSubmittedAt ? values.documentsSubmittedAt.toISOString() : null,
      arrivedAt: values.arrivedAt ? values.arrivedAt.toISOString() : null,
      workOutcome: values.workOutcome.trim() || null,
      payoutStatus: values.payoutStatus.trim() || null,
      paymentStatus: values.paymentStatus.trim() || null,
      retention: values.retention.trim() || null,
      messenger: values.messenger.trim() || null,
      experience: values.experience.trim() || null,
    };
    // Consent fields are create-only. Omitting them entirely on edit keeps them
    // out of the dirty-diff (`changed`) so an edit can never fabricate/revoke a
    // consent. consentBasis must be a valid enum value or absent — never ''.
    if (isCreate) {
      payload.emailConsentAccepted = values.emailConsentAccepted;
      payload.smsConsentAccepted = values.smsConsentAccepted;
      payload.consentBasis =
        (values.emailConsentAccepted || values.smsConsentAccepted) && values.consentBasis
          ? values.consentBasis
          : undefined;
    }
    return payload;
  }

  function handleSubmit(values: FormValues) {
    const payload = buildPayload(values, syncStatus(values));
    // 2026-07-10 dirty-diff: diff SUBMITTED shapes (same transformation applied
    // to initialValues, including the status auto-bump) so only user edits end
    // up in `changed`. Full-payload PATCH used to 400 on rows whose untouched
    // legacy fields no longer pass today's validation.
    const base = initial ? buildPayload(initialValues, syncStatus(initialValues)) : null;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(payload) as Array<keyof CreateCandidateInput>) {
      if (!base || payload[key] !== base[key]) changed[key] = payload[key];
    }
    onSubmit(payload, changed as UpdateCandidateInput);
  }

  // The form is long — a validation error can render off-screen and the Save
  // button looks dead. Announce the failure and scroll the first invalid
  // input into view (rAF: errors paint on the next frame).
  function handleValidationFailure() {
    notifications.show({ color: 'red', message: t('form.validationFailed') });
    requestAnimationFrame(() => {
      const invalid = document.querySelector('[aria-invalid="true"], [data-error="true"]');
      // scrollIntoView is missing in jsdom — guard keeps tests quiet.
      invalid?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
  }

  return (
    <form noValidate onSubmit={form.onSubmit(handleSubmit, handleValidationFailure)}>
      <Stack>
        <TextInput
          label={t('fields.fullName')}
          {...form.getInputProps('fullName')}
          required
          autoComplete="name"
          autoCapitalize="words"
        />
        <Row isMobile={isMobile}>
          <TextInput
            label={t('fields.email')}
            {...form.getInputProps('email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
          <TextInput
            label={t('fields.phone')}
            {...form.getInputProps('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
        </Row>
        {/* 2026-06-12 — TG/WA/Viber single-line free-text. Placeholder hints
            at the accepted format ("TG: @ivan", "WA: +48123…") without
            enforcing it — recruiter types whatever the candidate gave them. */}
        <TextInput
          label={t('fields.messenger')}
          placeholder={t('fields.messengerPlaceholder', { defaultValue: 'TG: @username · WA: +48… · Viber: +380…' })}
          maxLength={200}
          {...form.getInputProps('messenger')}
        />
        <Row isMobile={isMobile} align="flex-end">
          <DateInput
            label={t('fields.birthDate')}
            valueFormat="DD.MM.YYYY"
            clearable
            {...form.getInputProps('birthDate')}
          />
          <LookupSelect
            type="nationality"
            label={t('fields.nationality')}
            value={form.values.nationality || null}
            onChange={(v) => form.setFieldValue('nationality', v ?? '')}
          />
        </Row>
        {/* Date-only per client request 2026-07-04 — the business dates carry
            no meaningful hour, and the HH:mm suffix confused users. */}
        <Row isMobile={isMobile}>
          <DateInput
            label={t('fields.workStartDate')}
            valueFormat="DD.MM.YYYY"
            clearable
            {...form.getInputProps('workStartDate')}
          />
          <DateInput
            label={t('fields.workEndDate')}
            valueFormat="DD.MM.YYYY"
            clearable
            {...form.getInputProps('workEndDate')}
          />
        </Row>
        {/* 2026-06-12: workEndReason switched from free text to a LookupSelect
            backed by status_lookups type=dismissal_reason. Any user can add
            new reasons inline via the "+ Dodaj nową" button. Existing rows
            that hold free-text values stay selectable — buildLookupOptions
            appends the current value as its own option when it isn't in the
            active list. `reasonNote` below stays free text for verbatim
            recruiter notes that complement the canonical reason. */}
        <LookupSelect
          type="dismissal_reason"
          label={t('fields.workEndReason')}
          value={form.values.workEndReason || null}
          onChange={(v) => form.setFieldValue('workEndReason', v ?? '')}
        />
        <Textarea label={t('fields.reasonNote')} {...form.getInputProps('reasonNote')} minRows={2} />
        <Row isMobile={isMobile} align="flex-end">
          <Select
            label={t('fields.status')}
            data={CANDIDATE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
            {...form.getInputProps('status')}
          />
          {/* Source — LookupSelect with inline "+ Add new" (any authenticated
              user). Backed by status_lookups type=sources. Optional since
              2026-07-02 (only the full name is obligatory). */}
          {!hiddenFields.has('source') && (
            <LookupSelect
              type="sources"
              label={t('fields.source')}
              value={form.values.source || null}
              onChange={(v) => form.setFieldValue('source', v ?? '')}
            />
          )}
        </Row>
        {isAdmin && (
          <Select
            label={t('fields.recruiter')}
            placeholder={t('list.filters.allRecruiters', { defaultValue: '—' })}
            data={recruiterOptions}
            value={form.values.recruiterId || null}
            onChange={(v) => form.setFieldValue('recruiterId', v ?? '')}
            error={form.errors.recruiterId}
            searchable
            clearable
          />
        )}
        <Row isMobile={isMobile}>
          <Select
            label={t('fields.housing', { defaultValue: 'Mieszkanie' })}
            placeholder={t('housing.placeholder', { defaultValue: 'Wybierz typ mieszkania…' })}
            data={[
              { value: 'our', label: t('housing.our') },
              { value: 'own', label: t('housing.own') },
            ]}
            value={form.values.housingType || null}
            onChange={(v) => form.setFieldValue('housingType', (v as HousingType | null) ?? '')}
            clearable
          />
          <ProjectSelect
            value={form.values.projectId}
            onChange={(v) => form.setFieldValue('projectId', v)}
          />
        </Row>
        <Select
          label={t('fields.coordinator')}
          placeholder={t('list.filters.allCoordinators', { defaultValue: '—' })}
          data={coordinatorOptions}
          value={form.values.coordinatorId}
          onChange={(v) => form.setFieldValue('coordinatorId', v)}
          clearable
          searchable
        />
        {/* 2026-06-10 Excel-import prep fields. Position + Legal Status are
            user-extendable dropdowns from status_lookups; the other two are
            free text. */}
        <Row isMobile={isMobile} align="flex-end">
          <LookupSelect
            type="position"
            label={t('fields.position')}
            value={form.values.position || null}
            onChange={(v) => form.setFieldValue('position', v ?? '')}
          />
          <LookupSelect
            type="legal_status"
            label={t('fields.legalStatus')}
            value={form.values.legalStatus || null}
            onChange={(v) => form.setFieldValue('legalStatus', v ?? '')}
          />
        </Row>
        {!hiddenFields.has('reconciliationPeriod') && (
          <TextInput
            label={t('fields.reconciliationPeriod')}
            {...form.getInputProps('reconciliationPeriod')}
            maxLength={200}
          />
        )}
        {/* 2026-06-10 Block 7 (Звірка / Виплати) — month-end reconciliation.
            Picking a date here triggers a forward-only status sync in
            handleSubmit (e.g. documentsSubmittedAt set ⇒ status bumps to
            'documents_submitted' if currently earlier in the funnel). The
            four LookupSelects below are coordinator-only badges. */}
        <Row isMobile={isMobile}>
          {!hiddenFields.has('documentsSubmittedAt') && (
            <DateInput
              label={t('fields.documentsSubmittedAt')}
              valueFormat="DD.MM.YYYY"
              clearable
              {...form.getInputProps('documentsSubmittedAt')}
            />
          )}
          <DateInput
            label={t('fields.arrivedAt')}
            valueFormat="DD.MM.YYYY"
            clearable
            {...form.getInputProps('arrivedAt')}
          />
        </Row>
        <Row isMobile={isMobile} align="flex-end">
          {!hiddenFields.has('workOutcome') && (
            <LookupSelect
              type="work_outcome"
              label={t('fields.workOutcome')}
              value={form.values.workOutcome || null}
              onChange={(v) => form.setFieldValue('workOutcome', v ?? '')}
            />
          )}
          <LookupSelect
            type="retention"
            label={t('fields.retention')}
            value={form.values.retention || null}
            onChange={(v) => form.setFieldValue('retention', v ?? '')}
          />
        </Row>
        {!(hiddenFields.has('payoutStatus') && hiddenFields.has('paymentStatus')) && (
          <Row isMobile={isMobile} align="flex-end">
            {!hiddenFields.has('payoutStatus') && (
              <LookupSelect
                type="payout_status"
                label={t('fields.payoutStatus')}
                value={form.values.payoutStatus || null}
                onChange={(v) => form.setFieldValue('payoutStatus', v ?? '')}
              />
            )}
            {!hiddenFields.has('paymentStatus') && (
              <LookupSelect
                type="payment_status"
                label={t('fields.paymentStatus')}
                value={form.values.paymentStatus || null}
                onChange={(v) => form.setFieldValue('paymentStatus', v ?? '')}
              />
            )}
          </Row>
        )}
        {/* 2026-06-12 — «Досвід роботи» — free-text work history, autosizing
            up to ~5000 chars. Placeholder gives a hint at the expected shape
            ("2 роки на заводі в Польщі, 1 рік водієм…") without enforcing it. */}
        <Textarea
          label={t('fields.experience')}
          placeholder={t('fields.experiencePlaceholder', {
            defaultValue: 'Наприклад: 2 роки на заводі в Польщі, 1 рік водієм…',
          })}
          maxLength={5000}
          {...form.getInputProps('experience')}
          minRows={3}
          autosize
        />
        <Textarea label={t('fields.notes')} {...form.getInputProps('notes')} minRows={3} autosize />
        {isCreate && (
          <CandidateConsentFields
            emailAccepted={form.values.emailConsentAccepted}
            smsAccepted={form.values.smsConsentAccepted}
            basis={form.values.consentBasis}
            basisError={form.errors.consentBasis}
            onEmailChange={(v) => form.setFieldValue('emailConsentAccepted', v)}
            onSmsChange={(v) => form.setFieldValue('smsConsentAccepted', v)}
            onBasisChange={(v) => form.setFieldValue('consentBasis', v)}
          />
        )}
        <Group justify="flex-end">
          {/* type="button" stops the cancel button from doubling as a stealth
              submit — Mantine <Button> has no default `type`, so the browser
              falls back to HTML's `submit`. */}
          <Button type="button" variant="subtle" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
