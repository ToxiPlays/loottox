// preview-window.js
//
// Ensures a song's mediaDictionary entry has a saved preview window,
// computing it once via audioExcerpt.js and persisting it. Subsequent
// calls for the same song are just a dictionary lookup.

import { computeExcitingWindow } from './audio-wxcerpt.js';

/**
 * @param {string} songName - key into mediaDictionary
 * @param {object} mediaDictionary - in-memory catalog, keyed by song name
 * @param {(dict: object) => Promise<void>} saveMediaDictionary - persists mediaDictionary
 * @param {number} [windowSeconds=17]
 * @returns {Promise<{ start: number, end: number }>}
 */
export async function ensurePreviewWindow(
  songName,
  mediaDictionary,
  saveMediaDictionary,
  windowSeconds = 17,
) {
  const entry = mediaDictionary[songName];
  if (!entry) {
    throw new Error(`Unknown song: ${songName}`);
  }

  // Already computed — just reuse it.
  if (typeof entry.previewStart === 'number' && typeof entry.previewEnd === 'number') {
    return { start: entry.previewStart, end: entry.previewEnd };
  }

  if (!entry.filePath) {
    throw new Error(`mediaDictionary entry for "${songName}" has no filePath to analyze`);
  }

  const { start, end } = await computeExcitingWindow(entry.filePath, windowSeconds);

  entry.previewStart = start;
  entry.previewEnd = end;
  await saveMediaDictionary(mediaDictionary);

  return { start, end };
}