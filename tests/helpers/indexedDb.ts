/** Browser-context IndexedDB inspection and fault setup used only to establish durability/recovery preconditions. */
import type { Page } from '@playwright/test';

export const readLocalDatabaseLayout = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ hasBoardImageIndex: boolean; version: number }>(
        (resolve, reject) => {
          const request = indexedDB.open('chalkboard-local');
          request.addEventListener('error', () => reject(request.error));
          request.addEventListener('success', () => {
            const database = request.result;
            const hasBoardImageIndex = database
              .transaction('images')
              .objectStore('images')
              .indexNames.contains('boardId');
            resolve({ hasBoardImageIndex, version: database.version });
            database.close();
          });
        },
      ),
  );
