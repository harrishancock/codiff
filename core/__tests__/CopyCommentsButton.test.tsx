/**
 * @vitest-environment jsdom
 */

import { expect, test } from 'vite-plus/test';
import { CopyAllCommentsButton } from '../app/components/Panels.tsx';
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
