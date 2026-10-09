/** Seeds an exact versioned IndexedDB local board before application startup for compatibility/recovery stories. */
import { CHALKBOARD_SCHEMA_VERSIONS } from '@chalkboard/shared';
import { expect, type Page } from '@playwright/test';

export async function seedLocalBoard(
  page: Page,
  boardId: string,
  elements: readonly Record<string, unknown>[],
): Promise<void> {
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.evaluate(
    ({ elements: seededElements, id, version }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('chalkboard-local', version);
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const database = open.result;
          const transaction = database.transaction('boards', 'readwrite');
          const boards = transaction.objectStore('boards');
          const current = boards.get(`local:${id}`);
          current.addEventListener('error', () => reject(current.error));
          current.addEventListener('success', () => {
            if (current.result === undefined) {
              transaction.abort();
              reject(new Error('Local board fixture record is missing'));
              return;
            }
            boards.put({
              ...current.result,
              elements: seededElements,
              mixedContentByElementId: {},
              updatedAt: Date.now() + 1_000,
            });
          });
          transaction.addEventListener('error', () =>
            reject(transaction.error),
          );
          transaction.addEventListener('complete', () => {
            database.close();
            resolve();
          });
        });
      }),
    {
      elements,
      id: boardId,
      version: CHALKBOARD_SCHEMA_VERSIONS.indexedDb,
    },
  );
}
