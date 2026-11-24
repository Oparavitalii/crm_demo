import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TypographyStylesProvider } from '@mantine/core';

export function MarkdownView({ children }: { children: string }) {
  return (
    <TypographyStylesProvider>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </TypographyStylesProvider>
  );
}
