import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { ForbiddenPage } from './ForbiddenPage';
import type { UserRole } from '@crm/shared';

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: UserRole[];
}) {
  const bootComplete = useAuthStore((s) => s.bootComplete);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!bootComplete) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <ForbiddenPage />;
  return <>{children}</>;
}
