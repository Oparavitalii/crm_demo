import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Center, Stack, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Splash } from '@/components/Splash';
import { CookieBanner } from '@/components/CookieBanner';
import { AppShellLayout } from '@/components/AppShell/AppShellLayout';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { ForbiddenPage } from '@/features/auth/ForbiddenPage';

const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const ResetPasswordRequestPage = lazy(() =>
  import('@/features/auth/ResetPasswordRequestPage').then((m) => ({ default: m.ResetPasswordRequestPage })),
);
const ResetPasswordConfirmPage = lazy(() =>
  import('@/features/auth/ResetPasswordConfirmPage').then((m) => ({ default: m.ResetPasswordConfirmPage })),
);
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const CandidateList = lazy(() => import('@/features/candidates/CandidateList').then((m) => ({ default: m.CandidateList })));
const PeopleListPage = lazy(() => import('@/features/candidates/PeopleListPage').then((m) => ({ default: m.PeopleListPage })));
const ClientListPage = lazy(() => import('@/features/clients/ClientListPage').then((m) => ({ default: m.ClientListPage })));
const CandidateCreatePage = lazy(() => import('@/features/candidates/CandidateCreatePage').then((m) => ({ default: m.CandidateCreatePage })));
const CandidateDetailPage = lazy(() => import('@/features/candidates/CandidateDetailPage').then((m) => ({ default: m.CandidateDetailPage })));
const CandidateEditPage = lazy(() => import('@/features/candidates/CandidateEditPage').then((m) => ({ default: m.CandidateEditPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AnalyticsPage = lazy(() => import('@/features/dashboard/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const UserListPage = lazy(() => import('@/features/admin-users/UserListPage').then((m) => ({ default: m.UserListPage })));
const UserCreatePage = lazy(() => import('@/features/admin-users/UserCreatePage').then((m) => ({ default: m.UserCreatePage })));
const UserDetailPage = lazy(() => import('@/features/admin-users/UserDetailPage').then((m) => ({ default: m.UserDetailPage })));
const UserEditPage = lazy(() => import('@/features/admin-users/UserEditPage').then((m) => ({ default: m.UserEditPage })));
const UserStatsPage = lazy(() => import('@/features/admin-users/UserStatsPage').then((m) => ({ default: m.UserStatsPage })));
const FreelancerStatsPage = lazy(() => import('@/features/admin-users/FreelancerStatsPage').then((m) => ({ default: m.FreelancerStatsPage })));
// Vacancies module removed 2026-06-02 — replaced by Projects. The
// `submittedToVacancyId` field on candidates is now informational only;
// users now organize work around projects (Northwind Logistics Wrocław, Adventure Works Opole, …)
// via the new `/projects` page.
const ProjectsListPage = lazy(() => import('@/features/projects/ProjectsListPage').then((m) => ({ default: m.ProjectsListPage })));
const AccommodationListPage = lazy(() => import('@/features/accommodations/AccommodationListPage').then((m) => ({ default: m.AccommodationListPage })));
const DismissalRegistryPage = lazy(() => import('@/features/dismissals/DismissalRegistryPage').then((m) => ({ default: m.DismissalRegistryPage })));
const FailedCandidatesReportPage = lazy(() => import('@/features/failed-candidates/FailedCandidatesReportPage').then((m) => ({ default: m.FailedCandidatesReportPage })));
const EmployerInquiryListPage = lazy(() => import('@/features/employer-inquiries/EmployerInquiryListPage').then((m) => ({ default: m.EmployerInquiryListPage })));
const EmployerInquiryDetailPage = lazy(() => import('@/features/employer-inquiries/EmployerInquiryDetailPage').then((m) => ({ default: m.EmployerInquiryDetailPage })));
const TemplateListPage = lazy(() => import('@/features/communications/TemplateListPage').then((m) => ({ default: m.TemplateListPage })));
const TemplateCreatePage = lazy(() => import('@/features/communications/TemplateCreatePage').then((m) => ({ default: m.TemplateCreatePage })));
const TemplateDetailPage = lazy(() => import('@/features/communications/TemplateDetailPage').then((m) => ({ default: m.TemplateDetailPage })));
const TemplateEditPage = lazy(() => import('@/features/communications/TemplateEditPage').then((m) => ({ default: m.TemplateEditPage })));
const BulkSendPage = lazy(() => import('@/features/communications/BulkSendPage').then((m) => ({ default: m.BulkSendPage })));
const HistoryPage = lazy(() => import('@/features/communications/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const AuditLogPage = lazy(() => import('@/features/admin-audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const ProfilePage = lazy(() => import('@/features/admin/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const DocumentListPage = lazy(() => import('@/features/documents/DocumentListPage').then((m) => ({ default: m.DocumentListPage })));
const DocumentDetailPage = lazy(() => import('@/features/documents/DocumentDetailPage').then((m) => ({ default: m.DocumentDetailPage })));
const AdminDocumentListPage = lazy(() => import('@/features/documents/AdminDocumentListPage').then((m) => ({ default: m.AdminDocumentListPage })));
const AdminDocumentCreatePage = lazy(() => import('@/features/documents/AdminDocumentCreatePage').then((m) => ({ default: m.AdminDocumentCreatePage })));
const AdminDocumentEditPage = lazy(() => import('@/features/documents/AdminDocumentEditPage').then((m) => ({ default: m.AdminDocumentEditPage })));
const AdminDocumentAcceptancesPage = lazy(() => import('@/features/documents/AdminDocumentAcceptancesPage').then((m) => ({ default: m.AdminDocumentAcceptancesPage })));
const TasksListPage = lazy(() => import('@/features/tasks/TasksListPage').then((m) => ({ default: m.TasksListPage })));
const StatusManagementPage = lazy(() => import('@/features/admin-statuses/StatusManagementPage').then((m) => ({ default: m.StatusManagementPage })));
const WithdrawConsentPage = lazy(() => import('@/features/consents/WithdrawConsentPage').then((m) => ({ default: m.WithdrawConsentPage })));
const ConfirmConsentPage = lazy(() => import('@/features/consents/ConfirmConsentPage').then((m) => ({ default: m.ConfirmConsentPage })));
const PrivacyPage = lazy(() => import('@/features/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const ApplyPage = lazy(() => import('@/features/public-apply/ApplyPage').then((m) => ({ default: m.ApplyPage })));

function NotFound() {
  const { t } = useTranslation('errors');
  return (
    <Center mih="60vh">
      <Stack align="center"><Title order={2}>404</Title><Text c="dimmed">{t('notFound')}</Text></Stack>
    </Center>
  );
}

export function Router() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordRequestPage />} />
          <Route path="/reset-password/confirm" element={<ResetPasswordConfirmPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/withdraw/:token" element={<WithdrawConsentPage />} />
          <Route path="/consent/confirm/:token" element={<ConfirmConsentPage />} />
          <Route path="/apply/:slug" element={<ApplyPage />} />
          <Route path="/apply" element={<ApplyPage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppShellLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            {/* 2026-06-12: `/candidates` and `/clients` now show the same
                unified 8-status roster. The `kind` prop is still threaded
                through purely as a cosmetic hint — it toggles the page
                title (Кандидати / Клієнти), the "Add" button label, and the
                per-URL localStorage keys for column visibility. Backend
                filtering on `kind` was dropped. */}
            <Route path="/candidates" element={<CandidateList kind="candidate" />} />
            <Route path="/clients" element={<ClientListPage />} />
            {/* "Всі" — the same roster with NO status-bucket filter, so
                candidates and clients appear in one list. */}
            <Route path="/people" element={<PeopleListPage />} />
            <Route path="/candidates/new" element={<CandidateCreatePage />} />
            <Route path="/candidates/:id" element={<CandidateDetailPage />} />
            <Route path="/candidates/:id/edit" element={<CandidateEditPage />} />
            <Route path="/communications" element={<TemplateListPage />} />
            <Route path="/communications/new" element={<TemplateCreatePage />} />
            <Route
              path="/communications/send"
              element={
                <ProtectedRoute roles={['admin']}>
                  <BulkSendPage />
                </ProtectedRoute>
              }
            />
            <Route path="/communications/history" element={<HistoryPage />} />
            <Route path="/communications/:id" element={<TemplateDetailPage />} />
            <Route path="/communications/:id/edit" element={<TemplateEditPage />} />
            <Route path="/projects" element={<ProjectsListPage />} />
            <Route path="/accommodations" element={<AccommodationListPage />} />
            <Route path="/dismissals" element={<DismissalRegistryPage />} />
            <Route path="/failed-candidates" element={<FailedCandidatesReportPage />} />
            <Route path="/tasks" element={<TasksListPage />} />
            <Route path="/employer-inquiries" element={<EmployerInquiryListPage />} />
            <Route path="/employer-inquiries/:id" element={<EmployerInquiryDetailPage />} />
            <Route path="/documents" element={<DocumentListPage />} />
            <Route path="/documents/:slug" element={<DocumentDetailPage />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <UserListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute roles={['admin']}>
                  <UserListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/new"
              element={
                <ProtectedRoute roles={['admin']}>
                  <UserCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/:id"
              element={
                <ProtectedRoute roles={['admin']}>
                  <UserDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/:id/edit"
              element={
                <ProtectedRoute roles={['admin']}>
                  <UserEditPage />
                </ProtectedRoute>
              }
            />
            {/* Per-user analytics drill-down. Lives under /analytics because
                that's where recruiters and admins naturally look for KPI data.
                No role gate at the router level — the API enforces "admin OR
                self" so recruiters/coordinators can land on their own page via
                a direct link or by clicking a row in the recruiter KPI table. */}
            <Route path="/analytics/users/:userId" element={<UserStatsPage />} />
            {/* External-freelancer analytics drill-down. Admin-only — the API
                returns 403 for non-admin actors (freelancers have no login). */}
            <Route
              path="/analytics/freelancers/:id"
              element={
                <ProtectedRoute roles={['admin']}>
                  <FreelancerStatsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/audit-log"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AuditLogPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/documents"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDocumentListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/documents/new-md"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDocumentCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/documents/new-file"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDocumentCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/documents/:id/edit"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDocumentEditPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/documents/:id/acceptances"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDocumentAcceptancesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/settings/statuses"
              element={
                <ProtectedRoute roles={['admin']}>
                  <StatusManagementPage />
                </ProtectedRoute>
              }
            />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <CookieBanner />
    </BrowserRouter>
  );
}
