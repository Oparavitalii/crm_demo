import { useEffect, useState } from 'react';
import { Anchor, Button, Group, Paper, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'crm.cookieConsent.v1';

// Minimal cookie notice. We use only strictly-necessary cookies (httpOnly
// refresh, language preference) — so under RODO this is a notice, not a
// consent dialog. A single "OK, got it" dismiss is enough; we still record the
// dismissal so the banner doesn't re-appear on every visit.
export function CookieBanner() {
  const { t } = useTranslation('auth');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== 'accepted') {
        setVisible(true);
      }
    } catch {
      // localStorage disabled (private mode) — show the banner each visit;
      // there is nothing else we can do without it.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <Paper
      withBorder
      shadow="md"
      radius="md"
      p="md"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 720,
        margin: '0 auto',
        zIndex: 1000,
        background: 'var(--mantine-color-body)',
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="md">
        <div style={{ flex: 1 }}>
          <Text size="sm">{t('cookies.message')}</Text>
          <Anchor component={Link} to="/privacy" size="xs">
            {t('cookies.moreInfo')}
          </Anchor>
        </div>
        <Button
          size="xs"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, 'accepted');
            } catch {
              /* private mode — best effort */
            }
            setVisible(false);
          }}
        >
          {t('cookies.accept')}
        </Button>
      </Group>
    </Paper>
  );
}
