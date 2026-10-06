import { parseTTML } from './ttml-renderer.js';

// ---- Tunables -------------------------------------------------------------
const OFFSET_PX      = 2;      // vertical travel used by every fade
const RISE_FRACTION  = 2 / 3;  // token translate finishes in this share of its duration
const NOTE_BASE      = 0.3;    // resting opacity of each ♪ / of an earlier overlapped line
const INTRO_MIN      = 3;      // intro must be longer than this to show ♪♪♪
const GAP_SHORT      = 0.5;    // gaps <= this: previous group stays put
const GAP_LONG       = 2.5;    // gaps >  this: hold, fade, then ♪♪♪
const LONG_HOLD      = 1;      // seconds the previous group stays in long gaps
const LONG_FADE      = 0.5;    // fade time for long gaps AND for dimming a finished overlapped line
const END_HOLD       = 1;      // after last group: hold...
const END_FADE       = 1;      // ...then fade out

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn  = (x) => x * x * x;

/**
 * Lines that overlap in time (even slightly) form a "group" that is stacked
 * vertically and handled as one unit by the gap/intro/outro rules.
 */
function groupLines(lines) {
    const sorted = lines.slice().sort((a, b) => a.begin - b.begin);
    const groups = [];
    let cur = null;
    for (const line of sorted) {
        if (cur && line.begin < cur.end) {
            cur.lines.push(line);
            cur.end = Math.max(cur.end, line.end);
        } else {
            cur = { begin: line.begin, end: line.end, lines: [line] };
            groups.push(cur);
        }
    }
    return groups;
}

/**
 * Mount the compact renderer into `container` (the `.ttml` div).
 * Time comes from `wavesurfer.getCurrentTime()`, so seeking just works.
 */
export function mountInventoryTTML(container, lines, wavesurfer) {
    container.innerHTML = '';
    if (!lines.length) return { destroy() {} };

    const groups = groupLines(lines);

    // Groups and the ♪ row share one grid cell, so the box keeps a stable
    // height and only the "current" one is ever visible.
    container.style.display = 'grid';
    const stack = (el) => { el.style.gridArea = '1 / 1'; el.style.opacity = '0'; container.appendChild(el); };

    const groupEls = groups.map((group) => {
        const wrap = document.createElement('div');
        const lineObjs = group.lines.map((line) => {
            const p = document.createElement('p');
            p.className = 'lyric';
            const toks = line.tokens.map((tok, i) => {
                if (i > 0) p.appendChild(document.createTextNode(tok.spaceBefore ? ' ' : '\u2060'));
                const span = document.createElement('span');
                span.className = 'token';
                if (/\*{4,}/.test(tok.text)) span.classList.add('censor-token');
                span.textContent = tok.text;
                span.style.display = 'inline-block'; // transforms need a box
                span.style.opacity = '0';            // unsung lines occupy space but are invisible
                p.appendChild(span);
                return { el: span, begin: tok.begin, end: tok.end };
            });
            wrap.appendChild(p);
            // An earlier line dims once it finishes, but only if the group is still going.
            return { el: p, toks, end: line.end, dims: line.end < group.end };
        });
        stack(wrap);
        return { el: wrap, lines: lineObjs };
    });

    const notesEl = document.createElement('p');
    notesEl.className = 'lyric';
    const noteSpans = [0, 1, 2].map(() => {
        const s = document.createElement('span');
        s.textContent = '♪';
        notesEl.appendChild(s);
        return s;
    });
    stack(notesEl);

    // ---- Timeline: what should be on screen at time t? ----------------------
    // Returns { gi, fade } for a group (fade 0..1 = whole-group fade-out),
    // { notes: { local, D } } for the ♪♪♪ sequence, or {} for nothing.
    function getState(t) {
        let gi = -1;
        for (let i = groups.length - 1; i >= 0; i--) {
            if (groups[i].begin <= t) { gi = i; break; }
        }

        if (gi === -1) {
            const D = groups[0].begin;                      // intro
            return D > INTRO_MIN ? { notes: { local: t, D } } : {};
        }

        const group = groups[gi];
        if (t < group.end) return { gi, fade: 0 };          // someone is still being sung

        const el   = t - group.end;
        const next = groups[gi + 1];

        if (!next) {                                        // after the last group
            if (el < END_HOLD) return { gi, fade: 0 };
            const p = (el - END_HOLD) / END_FADE;
            return p >= 1 ? {} : { gi, fade: p };
        }

        const gap = next.begin - group.end;
        if (gap <= GAP_SHORT) return { gi, fade: 0 };       // keep it until the gap ends

        if (gap <= GAP_LONG) {                              // hold 40%, fade the last 60%
            const hold = gap * 0.4;
            return el < hold ? { gi, fade: 0 } : { gi, fade: (el - hold) / (gap - hold) };
        }

        if (el < LONG_HOLD) return { gi, fade: 0 };         // long gap
        if (el < LONG_HOLD + LONG_FADE) return { gi, fade: (el - LONG_HOLD) / LONG_FADE };
        const start = LONG_HOLD + LONG_FADE;
        return { notes: { local: el - start, D: gap - start } };
    }

    // ---- Rendering ----------------------------------------------------------
    let shownGi = -1;
    let notesShown = false;

    function renderLine(l, t) {
        for (const { el, begin, end } of l.toks) {
            let p = end > begin ? (t - begin) / (end - begin) : (t >= end ? 1 : 0);
            p = clamp01(p);
            el.style.opacity   = easeOut(p).toFixed(3);
            const rise         = easeOut(clamp01(p / RISE_FRACTION));
            el.style.transform = `translateY(${(OFFSET_PX * (1 - rise)).toFixed(2)}px)`;
        }
        const dim = l.dims ? easeOut(clamp01((t - l.end) / LONG_FADE)) : 0;
        l.el.style.opacity = (1 - (1 - NOTE_BASE) * dim).toFixed(3);
    }

    function renderNotes({ local, D }) {
        // 1/3 each for ♪1 and ♪2, the rest minus the tail for ♪3, then all fade out.
        const tail = D > 3 ? 1 : D / 6;
        const seg  = D / 3;
        const lit  = [
            easeOut(clamp01(local / seg)),
            easeOut(clamp01((local - seg) / seg)),
            easeOut(clamp01((local - 2 * seg) / (D - tail - 2 * seg))),
        ];
        const out = 1 - clamp01((local - (D - tail)) / tail);
        noteSpans.forEach((s, i) => {
            s.style.opacity = ((NOTE_BASE + (1 - NOTE_BASE) * lit[i]) * out).toFixed(3);
        });
    }

    let rafId = null, destroyed = false, lastT = -1;

    function frame() {
        if (destroyed) return;
        rafId = requestAnimationFrame(frame);

        const t = wavesurfer.getCurrentTime();
        if (t === lastT) return;            // paused: nothing to do
        lastT = t;

        const state = getState(t);

        if (state.gi !== undefined) {
            if (shownGi !== state.gi) {
                if (shownGi !== -1) groupEls[shownGi].el.style.opacity = '0';
                shownGi = state.gi;
            }
            const g = groupEls[shownGi];
            g.lines.forEach((l) => renderLine(l, t));
            g.el.style.opacity   = (1 - state.fade).toFixed(3);
            g.el.style.transform = `translateY(${(OFFSET_PX * easeIn(state.fade)).toFixed(2)}px)`;
        } else if (shownGi !== -1) {
            groupEls[shownGi].el.style.opacity = '0';
            shownGi = -1;
        }

        if (state.notes) {
            renderNotes(state.notes);
            notesEl.style.opacity = '1';
            notesShown = true;
        } else if (notesShown) {
            notesEl.style.opacity = '0';
            notesShown = false;
        }
    }

    rafId = requestAnimationFrame(frame);

    return {
        destroy() {
            destroyed = true;
            if (rafId) cancelAnimationFrame(rafId);
            container.innerHTML = '';
            container.style.display = '';
        },
    };
}

/**
 * Convenience wrapper for inventory.js: fetches the TTML, unhides the
 * container and mounts the renderer. Returns a handle synchronously, so it
 * is safe to destroy() even if the song row is collapsed mid-fetch.
 */
export function loadInventoryTTML(container, url, wavesurfer) {
    let inner = null;
    let cancelled = false;

    (async () => {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const lines = parseTTML(await res.text());
            if (cancelled || !lines.length) return;
            inner = mountInventoryTTML(container, lines, wavesurfer);
            container.classList.remove('hidden');
        } catch (err) {
            console.warn('Lyrics unavailable:', err.message);
        }
    })();

    return {
        destroy() {
            cancelled = true;
            inner?.destroy();
            container.classList.add('hidden');
        },
    };
}