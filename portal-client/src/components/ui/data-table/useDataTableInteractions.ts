import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ColumnLayout } from '@/lib/useColumnLayout';

export function useDataTableInteractions(layout: ColumnLayout) {
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const onResizeMove = useCallback((event: PointerEvent) => {
    const current = resizing.current;
    if (!current) return;
    layoutRef.current.setWidth(
      current.key,
      current.startW + (event.clientX - current.startX),
    );
  }, []);

  const endResize = useCallback(() => {
    resizing.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onResizeMove);
  }, [onResizeMove]);

  const startResize = useCallback((key: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = {
      key,
      startX: event.clientX,
      startW: layoutRef.current.widthOf(key),
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', endResize, { once: true });
  }, [onResizeMove, endResize]);

  function onHeaderDragStart(key: string, event: DragEvent) {
    if (resizing.current) {
      event.preventDefault();
      return;
    }
    setDragKey(key);
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', key);
    } catch {
      // Some browsers disallow setting drag data; the in-memory key still works.
    }
  }

  function onHeaderDragOver(key: string, event: DragEvent) {
    if (!dragKey || dragKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overKey !== key) setOverKey(key);
  }

  function onHeaderDrop(key: string, event: DragEvent) {
    event.preventDefault();
    if (dragKey) layout.reorder(dragKey, key);
    setDragKey(null);
    setOverKey(null);
  }

  function onHeaderDragEnd() {
    setDragKey(null);
    setOverKey(null);
  }

  return {
    dragKey,
    overKey,
    resizing,
    startResize,
    onHeaderDragStart,
    onHeaderDragOver,
    onHeaderDrop,
    onHeaderDragEnd,
  };
}

export type DataTableInteractions = ReturnType<typeof useDataTableInteractions>;
