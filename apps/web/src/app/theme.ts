import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Brand gold accent
const brand: MantineColorsTuple = [
  '#fdf8ec',
  '#f7ead0',
  '#eed5a1',
  '#e3bd6f',
  '#d9a945',
  '#d49d2a',
  '#C4A456', // Primary brand (index 6) — marketing site main gold
  '#a47e15',
  '#8e6b09',
  '#785a00',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: { fontFamily: 'Raleway, Inter, system-ui, sans-serif' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  shadows: {
    xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
    sm: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
    md: '0 4px 12px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.04)',
    lg: '0 10px 25px rgba(15, 23, 42, 0.08), 0 4px 10px rgba(15, 23, 42, 0.05)',
    xl: '0 20px 40px rgba(15, 23, 42, 0.10), 0 8px 16px rgba(15, 23, 42, 0.06)',
  },
  components: {
    Button: {
      defaultProps: {
        variant: 'filled',
      },
    },
  },
});
