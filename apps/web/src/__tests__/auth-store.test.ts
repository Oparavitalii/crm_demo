import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../lib/auth-store';

const sampleUser = {
  id: 'u1',
  email: 'admin@crm-demo.example',
  firstName: 'Admin',
  lastName: 'Demo',
  role: 'admin' as const,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  has2FA: false,
};

beforeEach(() => {
  useAuthStore.getState().clear();
  useAuthStore.setState({ bootComplete: false });
});

describe('auth-store', () => {
  it('starts empty with bootComplete=false', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.bootComplete).toBe(false);
  });

  it('setSession sets user + token', () => {
    useAuthStore.getState().setSession(sampleUser, 'tok-1');
    const s = useAuthStore.getState();
    expect(s.user).toEqual(sampleUser);
    expect(s.accessToken).toBe('tok-1');
  });

  it('setAccessToken updates only token', () => {
    useAuthStore.getState().setSession(sampleUser, 'tok-1');
    useAuthStore.getState().setAccessToken('tok-2');
    expect(useAuthStore.getState().accessToken).toBe('tok-2');
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });

  it('clear wipes user and token but not bootComplete', () => {
    useAuthStore.getState().setSession(sampleUser, 'tok-1');
    useAuthStore.getState().markBootComplete();
    useAuthStore.getState().clear();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.bootComplete).toBe(true);
  });

  it('markBootComplete sets flag', () => {
    useAuthStore.getState().markBootComplete();
    expect(useAuthStore.getState().bootComplete).toBe(true);
  });
});
