// String -> Array
export function parseTrackString(str) {
  return str
    .split('|')
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(':');
      const [time, tx, order] = parts.slice(-3).map(Number);
      const title = parts.slice(0, -3).join(':');
      return { title, time, tx, order };
    });
}

// Array -> String
export function stringifyTracks(tracks) {
  return tracks
    .map(({ title, time, tx, order }) => `${title}:${time}:${tx}:${order}`)
    .join('|');
}

// i ain't comin' back:1784953303033:1:1|wordle freestyle:1784953303037:1:2|funtimes:1784953303041:1:3