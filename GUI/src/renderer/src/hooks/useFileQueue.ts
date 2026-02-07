/**
 * useFileQueue - 文件队列管理 Hook
 * 管理翻译任务队列的添加、删除、排序等操作
 */

import { useState, useEffect, useRef, useCallback } from "react";

export interface UseFileQueueReturn {
  fileQueue: string[];
  currentIndex: number;
  isProcessing: boolean;

  // Actions
  addFiles: (files: string[]) => void;
  removeFile: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;

  // Queue Control
  startQueue: () => void;
  advanceQueue: () => boolean; // Returns true if there are more items
  resetQueue: () => void;

  // Refs for stable callbacks
  fileQueueRef: React.RefObject<string[]>;
  currentIndexRef: React.RefObject<number>;
}

export function useFileQueue(): UseFileQueueReturn {
  // Load from localStorage on init
  const [fileQueue, setFileQueue] = useState<string[]>(() => {
    const saved = localStorage.getItem("file_queue");
    return saved ? JSON.parse(saved) : [];
  });

  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs for stable IPC callbacks
  const fileQueueRef = useRef(fileQueue);
  const currentIndexRef = useRef(currentIndex);

  // Sync refs
  useEffect(() => {
    fileQueueRef.current = fileQueue;
  }, [fileQueue]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem("file_queue", JSON.stringify(fileQueue));
  }, [fileQueue]);

  // Actions
  const addFiles = useCallback((files: string[]) => {
    setFileQueue((prev) => {
      const existing = new Set(prev);
      const newFiles = files.filter((f) => !existing.has(f));
      return [...prev, ...newFiles];
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFileQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => {
    setFileQueue([]);
    setCurrentIndex(-1);
    setIsProcessing(false);
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setFileQueue((prev) => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
  }, []);

  // Queue Control
  const startQueue = useCallback(() => {
    if (fileQueue.length > 0) {
      setCurrentIndex(0);
      setIsProcessing(true);
    }
  }, [fileQueue.length]);

  const advanceQueue = useCallback((): boolean => {
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < fileQueueRef.current.length) {
      setCurrentIndex(nextIndex);
      return true;
    } else {
      setCurrentIndex(-1);
      setIsProcessing(false);
      return false;
    }
  }, []);

  const resetQueue = useCallback(() => {
    setCurrentIndex(-1);
    setIsProcessing(false);
  }, []);

  return {
    fileQueue,
    currentIndex,
    isProcessing,
    addFiles,
    removeFile,
    clearQueue,
    reorderQueue,
    startQueue,
    advanceQueue,
    resetQueue,
    fileQueueRef,
    currentIndexRef,
  };
}
