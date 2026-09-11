/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { expect, test, vi } from 'vite-plus/test';
import { CopyAllCommentsButton, MovedCodePaletteControl } from '../app/components/Panels.tsx';
import { renderReact } from './helpers/react.tsx';

test('shows the total pending comment count on the copy-all button', async () => {
  await using app = await renderReact(
    <CopyAllCommentsButton commentCount={17} getJSON={() => '[]'} />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('.copy-comments-button');
  expect(button?.getAttribute('aria-label')).toBe('Copy all 17 review comments as JSON');
  expect(button?.textContent).toBe('All (17)');
});

test('disables the copy-all button when there are no pending comments', async () => {
  await using app = await renderReact(
    <CopyAllCommentsButton commentCount={0} getJSON={() => '[]'} />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('.copy-comments-button');
  expect(button?.disabled).toBe(true);
  expect(button?.getAttribute('aria-label')).toBe(
    'Copy all review comments as JSON, no comments yet',
  );
});

test('cycles through moved-code palettes including off', async () => {
  const onChange = vi.fn();
  await using app = await renderReact(
    <MovedCodePaletteControl onChange={onChange} value="violet" />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Moves: Violet');
  await act(() => button?.click());
  expect(onChange).toHaveBeenCalledWith('off');
});
