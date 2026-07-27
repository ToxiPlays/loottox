// preview-song-route.js
//
// GET /api/previewSong/:name
//
// - Valid transaction for this song -> redirect to /api/getSong/:name (full track, existing auth path).
// - No valid transaction -> stream a 15-20s excerpt, computing+caching the
//   window on mediaDictionary the first time it's requested.

import { spawn } from 'child_process';
import { ensurePreviewWindow } from './preview-window.js';

const DEFAULT_PREVIEW_SECONDS = 17;

/**
 * Wire this up with your existing dependencies, e.g.:
 *   router.get('/api/previewSong/:name', previewSongHandler({
 *     mediaDictionary,
 *     saveMediaDictionary,
 *     hasValidTransaction,
 *   }));
 */
export function previewSongHandler({ mediaDictionary, saveMediaDictionary, hasValidTransaction }) {
  return async function previewSong(req, res) {
    const { name } = req.params;

    // Existing auth check — replace with however transactions are actually verified.
    const authorized = await hasValidTransaction(req, name);
    if (authorized) {
      return res.redirect(`/api/getSong/${encodeURIComponent(name)}`);
    }

    const entry = mediaDictionary[name];
    if (!entry) {
      return res.status(404).json({ error: 'Song not found' });
    }

    let window;
    try {
      window = await ensurePreviewWindow(
        name,
        mediaDictionary,
        saveMediaDictionary,
        DEFAULT_PREVIEW_SECONDS,
      );
    } catch (err) {
      console.error(`[previewSong] analysis failed for "${name}":`, err);
      return res.status(500).json({ error: 'Could not generate preview' });
    }

    streamExcerpt(entry.filePath, window.start, window.end, res);
  };
}

/** Streams [start, end] seconds of filePath as MP3, re-encoding for accurate cut points. */
function streamExcerpt(filePath, start, end, res) {
  const duration = (end - start).toFixed(2);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const ffmpeg = spawn('ffmpeg', [
    '-ss', String(start), // fast-ish seek; re-encoding below makes the cut sample-accurate
    '-i', filePath,
    '-t', duration,
    '-acodec', 'libmp3lame',
    '-b:a', '128k',
    '-f', 'mp3',
    'pipe:1',
  ]);

  ffmpeg.stderr.on('data', () => {}); // swallow ffmpeg logs; log if you want diagnostics
  ffmpeg.on('error', (err) => {
    console.error('[previewSong] ffmpeg spawn error:', err);
    if (!res.headersSent) res.status(500).end();
  });

  ffmpeg.stdout.pipe(res);

  // If the client disconnects mid-stream, don't leave ffmpeg running.
  res.on('close', () => {
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  });
}