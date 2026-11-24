import { useMediaQuery } from '@mantine/hooks';

// Returns true when viewport is below the Mantine "md" breakpoint (1024px) — covers phones AND tablets in portrait/landscape so the burger UI extends to iPad.
// Defaults to false on the server / first paint to match desktop layout.
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 63.99em)') ?? false;
}
