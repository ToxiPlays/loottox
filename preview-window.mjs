// preview-window.mjs
//
// Ensures a song's mediaDictionary entry has a saved preview window,
// computing it once via audioExcerpt.js and persisting it. Subsequent
// calls for the same song are just a dictionary lookup.

import { computeExcitingWindow } from './audio-excerpt.mjs';

/**
 * Mutates `entry` in place (adding previewStart/previewEnd) and persists it.
 * Works regardless of whether mediaDictionary is an array or a keyed object —
 * you find the entry however your code already does, and pass it in along
 * with the on-disk path to the actual audio file.
 *
 * @param {object} entry - the mediaDictionary record for this song (mutated in place)
 * @param {string} filePath - path to the source audio file to analyze
 * @param {(dict: any) => Promise<void>} saveMediaDictionary - persists mediaDictionary
 *   (swap this for whatever you use — write to disk, KV.put, DB update, etc.)
 * @param {any} mediaDictionary - the full dictionary, passed through to saveMediaDictionary
 * @param {number} [windowSeconds=17]
 * @returns {Promise<{ start: number, end: number }>}
 */
export async function ensurePreviewWindow(
  entry,
  filePath,
  saveMediaDictionary,
  mediaDictionary,
  windowSeconds = 17,
) {
  // Already computed — just reuse it.
  if (typeof entry.previewStart === 'number' && typeof entry.previewEnd === 'number') {
    return { start: entry.previewStart, end: entry.previewEnd };
  }

  const { start, end } = await computeExcitingWindow(filePath, windowSeconds);

  entry.previewStart = start;
  entry.previewEnd = end;
  await saveMediaDictionary(mediaDictionary);

  return { start, end };
}