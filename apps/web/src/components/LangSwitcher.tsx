import { Menu, Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

const LANGS: Array<{ code: 'pl' | 'ua'; label: string; flag: string }> = [
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'ua', label: 'Українська', flag: '🇺🇦' },
];

export function LangSwitcher() {
  const { i18n } = useTranslation();
  const current = LANGS.find((l) => l.code === i18n.resolvedLanguage) ?? LANGS[0]!;

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="subtle" size="xs" leftSection={<Languages size={16} />}>
          {current.flag} {current.code.toUpperCase()}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {LANGS.map((l) => (
          <Menu.Item key={l.code} onClick={() => void i18n.changeLanguage(l.code)}>
            {l.flag} {l.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
