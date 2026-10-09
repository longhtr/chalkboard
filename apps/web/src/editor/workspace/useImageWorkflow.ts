/**
 * Owns image file selection, browser admission, local placement, cloud upload,
 * local/cloud source migration, progress, cancellation, and object-URL cleanup.
 */
import {
  DEFAULT_ELEMENT_STYLE,
  screenToWorld,
  type BoardElement,
  type Camera,
  type ImageElement,
} from '@chalkboard/shared';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { randomUuid } from '../../randomUuid';

import { uploadCloudAsset } from '../cloud/cloudAssets';
import {
  importedImageDimensions,
  sanitizedImageFile,
} from '../portability/imageImport';
import { boardElementAdditionFits } from '../model/limits';
import type { CanvasSize } from '../interaction/rendering';

interface ImageWorkflowStatus {
  error: boolean;
  retry?: () => void;
  text: string;
}

interface ImageWorkflowOptions {
  boardId: string | null;
  camera: Camera;
  canvasSize: CanvasSize;
  cloudWritable: boolean;
  commitElements(elements: BoardElement[]): boolean;
  createdBy: string;
  elements: BoardElement[];
  elementsRef: RefObject<BoardElement[]>;
  onImported(image: ImageElement): void;
  onLimit(): void;
  onMessage(message: string): void;
  onStatus(status: ImageWorkflowStatus | null): void;
}

/**
 * Owns image sanitation, optional cloud upload, placement, retries, and legacy
 * data-URL migration. Async results are scoped to the board and operation that
 * created them so a late upload cannot modify a newly opened board.
 */
export function useImageWorkflow({
  boardId,
  camera,
  canvasSize,
  cloudWritable,
  commitElements,
  createdBy,
  elements,
  elementsRef,
  onImported,
  onLimit,
  onMessage,
  onStatus,
}: ImageWorkflowOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(0);
  const migratedImagesRef = useRef(new Set<string>());
  const activeBoardIdRef = useRef(boardId);

  useLayoutEffect(() => {
    activeBoardIdRef.current = boardId;
  }, [boardId]);

  const placeImage = async (
    imported: { name: string; source: string },
    natural: { height: number; width: number },
    operation: number,
  ) => {
    const targetBoardId = boardId;
    if (!boardElementAdditionFits(elementsRef.current.length, 1)) {
      onLimit();
      return;
    }
    try {
      let source = imported.source;
      if (targetBoardId !== null) {
        const asset = await uploadCloudAsset(targetBoardId, imported, {
          onProgress: (progress) => {
            if (operationRef.current !== operation) return;
            onStatus({
              error: false,
              text: `Uploading ${imported.name}… ${Math.round(progress * 100)}%`,
            });
          },
        });
        source = asset.url;
      }
      if (
        operationRef.current !== operation ||
        activeBoardIdRef.current !== targetBoardId
      ) {
        return;
      }

      const maximumScale = Math.min(
        1,
        640 / natural.width,
        480 / natural.height,
      );
      const scale =
        Math.max(natural.width, natural.height) < 64
          ? Math.min(
              64 / Math.max(natural.width, natural.height),
              640 / natural.width,
              480 / natural.height,
            )
          : maximumScale;
      const width = Math.max(1, natural.width * scale);
      const height = Math.max(1, natural.height * scale);
      const center = screenToWorld(
        { x: canvasSize.width / 2, y: canvasSize.height / 2 },
        camera,
      );
      const image: ImageElement = {
        ...DEFAULT_ELEMENT_STYLE,
        backgroundColor: 'transparent',
        createdBy,
        height,
        id: randomUuid(),
        name: imported.name,
        opacity: 1,
        rotation: 0,
        source,
        strokeColor: 'transparent',
        strokeWidth: 0,
        type: 'image',
        width,
        x: center.x - width / 2,
        y: center.y - height / 2,
      };
      if (!commitElements([...elementsRef.current, image])) return;
      onStatus(null);
      onImported(image);
      onMessage(
        targetBoardId === null
          ? `Imported ${imported.name}`
          : `Uploaded ${imported.name}`,
      );
    } catch (error) {
      if (operationRef.current !== operation) return;
      onStatus({
        error: true,
        retry: () => {
          if (operationRef.current === operation) {
            void placeImage(imported, natural, operation);
          }
        },
        text: error instanceof Error ? error.message : 'Image import failed',
      });
    }
  };

  const importImage = async (file: File) => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    onStatus(null);
    if (!boardElementAdditionFits(elementsRef.current.length, 1)) {
      onLimit();
      if (inputRef.current !== null) inputRef.current.value = '';
      return;
    }
    try {
      const imported = await sanitizedImageFile(file);
      const natural = await importedImageDimensions(imported.source);
      await placeImage(imported, natural, operation);
    } catch (error) {
      if (operationRef.current === operation) {
        onStatus({
          error: true,
          retry: () => void importImage(file),
          text: error instanceof Error ? error.message : 'Image import failed',
        });
      }
    } finally {
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (boardId === null || !cloudWritable) return;
    const legacyImages = elements.filter(
      (element): element is ImageElement =>
        element.type === 'image' &&
        element.source.startsWith('data:image/') &&
        !migratedImagesRef.current.has(element.id),
    );
    const migrate = async (element: ImageElement) => {
      migratedImagesRef.current.add(element.id);
      try {
        const asset = await uploadCloudAsset(boardId, element, {
          onProgress: (progress) => {
            if (activeBoardIdRef.current !== boardId) return;
            onStatus({
              error: false,
              text: `Moving ${element.name} to cloud storage… ${Math.round(progress * 100)}%`,
            });
          },
        });
        if (activeBoardIdRef.current !== boardId) return;
        const next = elementsRef.current.map((candidate) =>
          candidate.type === 'image' &&
          candidate.id === element.id &&
          candidate.source === element.source
            ? { ...candidate, source: asset.url }
            : candidate,
        );
        commitElements(next);
        onStatus(null);
        onMessage(`Moved ${element.name} to cloud storage`);
      } catch (error) {
        if (activeBoardIdRef.current !== boardId) return;
        onStatus({
          error: true,
          retry: () => void migrate(element),
          text:
            error instanceof Error
              ? error.message
              : 'The image could not be moved to cloud storage',
        });
      }
    };
    for (const element of legacyImages) void migrate(element);
  }, [
    boardId,
    cloudWritable,
    commitElements,
    elements,
    elementsRef,
    onMessage,
    onStatus,
  ]);

  return { imageInputRef: inputRef, importImage };
}
