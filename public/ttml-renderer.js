const GAP_THRESHOLD = 5;     // seconds — gaps longer than this get an interstitial line
const ADLIB_PRE     = 0.5;   // seconds before first adlib token to show the row
const ADLIB_POST    = 0.5;   // seconds after last adlib token to hide the row

// Ad-lib presence: fade in/out AND push/retract of the lines below (seconds)
const ADLIB_FADE    = 0.5;
const ADLIB_OPACITY = 0.6;

// Token rise: start at -RISE_PX, ease out to 0 over (token duration * RISE_DUR_MULT)
const RISE_PX       = 3;
const RISE_DUR_MULT = 1.2;

// Scroll / line-discard behaviour, chosen by the gap between a line's end and the next line's start
const GAP_SHORT           = 0.3;  // gap <  this: native smooth scroll (original behaviour)
const GAP_LONG            = 1.0;  // gap >= this: "long" mode; between the two: "medium" mode
const MEDIUM_SCROLL_FRAC  = 0.15; // medium: scroll + fade length as a fraction of the NEXT line's duration
const MIN_SCROLL_DUR      = 0.2;  // medium: floor so very short lines don't snap (set 0 to disable)
const LONG_HANG_FRAC      = 0.15; // long: hold current line for this fraction of the gap
const LONG_MOVE_FRAC      = 0.75; // long: scroll + fade over this fraction; the remainder highlights next line
const QUICK_FADE_DUR      = 0.5;  // fade used for short gaps, interstitial gaps and the last line

function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
}

function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Vertical offset for a token/letter: -RISE_PX before it starts, easing out to 0
// over (duration * RISE_DUR_MULT), i.e. slightly past the token's own end.
function riseOffset(b, e, t) {
    if (t <= b) return RISE_PX;
    const d = (e - b) * RISE_DUR_MULT;
    if (d <= 0 || t >= b + d) return 0;
    return RISE_PX * (1 - easeOutCubic((t - b) / d));
}

// Leaves are the elements that get swept + risen: letters of a split long word,
// the token span itself otherwise, or an ad-lib token span.
function getMainLeaves(tokEl) {
    return tokEl.classList.contains('ttml-token--split')
        ? Array.from(tokEl.querySelectorAll('.ttml-letter'))
        : [tokEl];
}

// A group = a set of leaves updated together, with cached timing so settled
// groups (before / after their window) cost nothing per frame.
function makeGroup(leaves) {
    let tStart = Infinity, tSettle = -Infinity;
    leaves.forEach(leaf => {
        leaf._b = parseFloat(leaf.dataset.begin);
        leaf._e = parseFloat(leaf.dataset.end);
        tStart  = Math.min(tStart, leaf._b);
        tSettle = Math.max(tSettle, leaf._e, leaf._b + (leaf._e - leaf._b) * RISE_DUR_MULT);
    });
    return { leaves, tStart, tSettle, phase: null };
}

function setLeaves(leaves, pct, offsetPx) {
    const transform = `translateY(${offsetPx}px)`;
    leaves.forEach(leaf => {
        leaf.style.setProperty('--sweep-pct', `${pct}%`);
        leaf.style.transform = transform;
    });
}

function updateLeaf(leaf, t) {
    const b = leaf._b, e = leaf._e;
    const pct = t >= e ? 100 : t <= b ? 0 : ((t - b) / (e - b)) * 100;
    leaf.style.setProperty('--sweep-pct', `${pct.toFixed(2)}%`);
    leaf.style.transform = `translateY(${riseOffset(b, e, t).toFixed(2)}px)`;
}

function updateGroup(group, t) {
    if (t < group.tStart) {
        if (group.phase !== 'pre')  { setLeaves(group.leaves, 0, RISE_PX); group.phase = 'pre'; }
    } else if (t >= group.tSettle) {
        if (group.phase !== 'post') { setLeaves(group.leaves, 100, 0);      group.phase = 'post'; }
    } else {
        group.phase = 'live';
        group.leaves.forEach(leaf => updateLeaf(leaf, t));
    }
}

/**
 * Median of a numeric array (average of the two middle values when even).
 */
function computeMedian(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Parse a TTML timestamp string (MM:SS.sss) to seconds.
 */
function parseTime(ts) {
    if (!ts) return 0;
    const [minsec, ms = '0'] = ts.split('.');
    const [min, sec] = minsec.split(':').map(Number);
    return min * 60 + sec + parseFloat('0.' + ms);
}

/**
 * Parse TTML XML string into an array of line objects.
 *
 * Each line:
 * {
 *   begin:  number,   // seconds — start of main line
 *   end:    number,   // seconds — end of main line
 *   agent:  string,   // 'v1', 'v2', etc.
 *   tokens: [{ text, begin, end, spaceBefore }],
 *   adlibs: [{
 *     tokens:     [{ text, begin, end, spaceBefore }],
 *     showAt:     number,   // max(line.begin, firstToken.begin - ADLIB_PRE)
 *     hideAt:     number,   // max(line.end,   lastToken.end  + ADLIB_POST)
 *   }]
 * }
 */
export function parseTTML(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const lines = [];

    for (const p of doc.querySelectorAll('body p')) {
        const begin = parseTime(p.getAttribute('begin'));
        const end   = parseTime(p.getAttribute('end'));
        const agent = p.getAttribute('ttm:agent') ?? 'v1';

        const tokens = [];
        const adlibs = [];

        const childNodes = Array.from(p.childNodes);
        let prevWasSpan = false;

        for (let i = 0; i < childNodes.length; i++) {
            const node = childNodes[i];

            if (node.nodeType === Node.TEXT_NODE) {
                prevWasSpan = false;
                continue;
            }

            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'span') {
                const role = node.getAttribute('ttm:role');

                if (role === 'x-bg') {
                    // Walk inner spans for per-token timing; strip edge parens from text.
                    const adlibTokens = [];
                    const innerNodes  = Array.from(node.childNodes);

                    for (let k = 0; k < innerNodes.length; k++) {
                        const inner = innerNodes[k];
                        if (inner.nodeType !== Node.ELEMENT_NODE || inner.tagName !== 'span') continue;

                        const text = inner.textContent.replace(/^\(+|\)+$/g, '');
                        if (!text) continue;

                        let spaceBefore = false;
                        if (adlibTokens.length > 0) {
                            for (let m = k - 1; m >= 0; m--) {
                                const prevInner = innerNodes[m];
                                if (prevInner.nodeType === Node.ELEMENT_NODE) break;
                                if (prevInner.nodeType === Node.TEXT_NODE && /[ \t]/.test(prevInner.textContent)) {
                                    spaceBefore = true;
                                    break;
                                }
                            }
                        }

                        adlibTokens.push({
                            text,
                            begin: parseTime(inner.getAttribute('begin')),
                            end:   parseTime(inner.getAttribute('end')),
                            spaceBefore,
                        });
                    }

                    // Fallback: no inner spans — treat wrapper as single token
                    if (adlibTokens.length === 0) {
                        const text = node.textContent.replace(/^\(+|\)+$/g, '').trim();
                        if (text) {
                            adlibTokens.push({
                                text,
                                begin: parseTime(node.getAttribute('begin')),
                                end:   parseTime(node.getAttribute('end')),
                                spaceBefore: false,
                            });
                        }
                    }

                    if (adlibTokens.length > 0) {
                        const firstBegin = adlibTokens[0].begin;
                        const lastEnd    = adlibTokens[adlibTokens.length - 1].end;
                        adlibs.push({
                            tokens:  adlibTokens,
                            showAt:  Math.min(begin, firstBegin - ADLIB_PRE),
                            hideAt:  Math.max(end,   lastEnd    + ADLIB_POST),
                        });
                    }

                    prevWasSpan = false;
                    continue;
                }

                // Main token — determine word boundary
                let spaceBefore = false;
                if (tokens.length > 0) {
                    for (let j = i - 1; j >= 0; j--) {
                        const prev = childNodes[j];
                        if (prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'span') break;
                        if (prev.nodeType === Node.TEXT_NODE &&
                            (prev.textContent.includes(' ') || /\S/.test(prev.textContent))) {
                            spaceBefore = true;
                            break;
                        }
                    }
                }

                tokens.push({
                    text: node.textContent,
                    begin: parseTime(node.getAttribute('begin')),
                    end:   parseTime(node.getAttribute('end')),
                    spaceBefore,
                });

                prevWasSpan = true;
            }
        }

        if (tokens.length > 0) {
            lines.push({ begin, end, agent, tokens, adlibs });
        }
    }

    return lines;
}

/**
 * Mount a TTML lyric renderer into a container element.
 *
 * @param {HTMLElement} container  — the .ttml-container div
 * @param {Array}       lines      — output of parseTTML()
 * @param {object}      wavesurfer — WaveSurfer instance for time sync
 * @returns {{ destroy: Function }}
 */
export function mountTTMLRenderer(container, lines, wavesurfer) {
    container.innerHTML = '';

    const scroller = document.createElement('div');
    scroller.className = 'ttml-scroller';
    container.appendChild(scroller);

    const mainDurations = [];
    lines.forEach(line => line.tokens.forEach(tok => mainDurations.push(tok.end - tok.begin)));
    const medianWordDur   = computeMedian(mainDurations);
    const LONG_WORD_LIMIT = medianWordDur * 3;

    // Build DOM. Each line element gets:
    //   el.mainRow          — the .ttml-main-row div
    //   el.adlibRowEls      — array of { el, adlib } for each adlib group
    const lineEls = lines.map((line) => {
        const el = document.createElement('div');
        el.className = 'ttml-line';
        if (line.agent === 'v2') {
            el.classList.add('ttml-line--v2');
            el.style.setProperty('--sweep-color', '#6477c4');
        }

        // Main row
        const mainRow = document.createElement('div');
        mainRow.className = 'ttml-main-row';
        line.tokens.forEach((token, ti) => {
            if (ti > 0) {
                if (token.spaceBefore) {
                    mainRow.appendChild(document.createTextNode(' '));
                } else {
                    mainRow.appendChild(document.createTextNode('\u2060'));
                }
            }
            const span = document.createElement('span');
            span.className = 'ttml-token';
            span.dataset.begin = token.begin;
            span.dataset.end   = token.end;

            const dur    = token.end - token.begin;
            const isLong = medianWordDur > 0 && dur > LONG_WORD_LIMIT;

            if (isLong) {
                // Long word: split into letters, each rising one-by-one,
                // staggered evenly across the word's duration.
                span.classList.add('ttml-token--split');
                const letters = Array.from(token.text);
                const n       = letters.length;
                const stagger = dur / n;
                letters.forEach((ch, li) => {
                    const letterSpan = document.createElement('span');
                    letterSpan.className = 'ttml-letter';
                    letterSpan.textContent = ch === ' ' ? '\u00A0' : ch;
                    const lb = token.begin + li * stagger;
                    const le = lb + stagger;
                    letterSpan.dataset.begin = lb;
                    letterSpan.dataset.end   = le;
                    span.appendChild(letterSpan);
                });
            } else {
                span.textContent = token.text;
            }

            mainRow.appendChild(span);
        });
        el.appendChild(mainRow);
        el.mainRow = mainRow;
        el.group = makeGroup(
            Array.from(mainRow.querySelectorAll('.ttml-token')).flatMap(getMainLeaves)
        );

        // Ad-lib rows are absolutely positioned (zero layout height). While shown,
        // the frame loop pushes later lines down by the row's height.
        el.adlibRowEls = line.adlibs.map(adlib => {
            const row = document.createElement('div');
            row.className = 'ttml-adlib-row';
            const tokenEls = [];
            adlib.tokens.forEach((token, ti) => {
                if (ti > 0 && token.spaceBefore) row.appendChild(document.createTextNode(' '));
                const span = document.createElement('span');
                span.className = 'ttml-token ttml-adlib-token';
                span.textContent = token.text;
                span.dataset.begin = token.begin;
                span.dataset.end   = token.end;
                row.appendChild(span);
                tokenEls.push(span);
            });
            el.appendChild(row);
            return { el: row, adlib, group: makeGroup(tokenEls), h: null, op: -1, ty: null };
        });

        scroller.appendChild(el);
        return el;
    });

    // Pre-compute gap interstitials
    const gaps = [];
    for (let i = 0; i < lines.length; i++) {
        const gapStart = i === 0 ? 0 : lines[i - 1].end;
        const gapEnd   = lines[i].begin;
        if (gapEnd - gapStart > GAP_THRESHOLD) {
            const label = i === 0 ? 'Intro' : '♪♪♪';
            gaps.push({ begin: gapStart, end: gapEnd, label, afterIdx: i - 1 });
        }
    }

    let gapLineEl   = null;
    let gapLineData = null;
    let rafId       = null;
    let destroyed   = false;

    function getCurrentTime() {
        return wavesurfer.getCurrentTime();
    }

    function findActiveGap(t) {
        for (const gap of gaps) {
            if (t >= gap.begin && t < gap.end) return gap;
        }
        return null;
    }

    // Duration of the colour transition when a line becomes highlighted
    // (long-gap lines override this with the remaining 10% of the gap).
    function getTransitionDuration(lineIdx) {
        const nextBegin = lines[lineIdx + 1]?.begin ?? (lines[lineIdx].end + 0.5);
        return Math.max(0.5, nextBegin - lines[lineIdx].end);
    }

    // ------------------------------------------------------------------
    // Schedules
    //
    // entrySched[j] describes how focus moves TO line j, chosen by the gap
    // between line j-1's end and line j's begin (line 0 uses prevEnd = 0):
    //   short  (< 0.3s)   native smooth scroll when the line becomes current
    //   medium (0.3-1s)   hold previous line; at j.begin scroll + fade over
    //                     15% of line j's duration (ease out)
    //   long   (1-5s)     hang 15% of gap; scroll (ease in/out) + fade over
    //                     75%; highlight line j over the final 10%
    //   interstitial      (> GAP_THRESHOLD) gap line owns scrolling
    //
    // exitSched[i] is the matching fade-out window for line i.
    // ------------------------------------------------------------------
    const entrySched = lines.map((line, j) => {
        const prevEnd = j === 0 ? 0 : lines[j - 1].end;
        const gap     = line.begin - prevEnd;

        if (gap > GAP_THRESHOLD) {
            return { mode: 'interstitial', start: line.begin, dur: 0,
                     hlAt: line.begin, hlDur: getTransitionDuration(j) };
        }
        if (gap >= GAP_LONG) {
            return { mode: 'long',
                     start: prevEnd + gap * LONG_HANG_FRAC,
                     dur:   gap * LONG_MOVE_FRAC,
                     ease:  easeInOutCubic,
                     hlAt:  prevEnd + gap * (LONG_HANG_FRAC + LONG_MOVE_FRAC),
                     hlDur: gap * (1 - LONG_HANG_FRAC - LONG_MOVE_FRAC) };
        }
        if (gap >= GAP_SHORT) {
            return { mode: 'medium',
                     start: line.begin,
                     dur:   Math.max(MIN_SCROLL_DUR, (line.end - line.begin) * MEDIUM_SCROLL_FRAC),
                     ease:  easeOutCubic,
                     hlAt:  line.begin, hlDur: getTransitionDuration(j) };
        }
        // Short gap or overlapping lines: scroll once the previous line has ended
        return { mode: 'short', start: Math.max(line.begin, prevEnd), dur: 0,
                 hlAt: line.begin, hlDur: getTransitionDuration(j) };
    });

    const exitSched = lines.map((line, i) => {
        const next = entrySched[i + 1];
        if (next && (next.mode === 'medium' || next.mode === 'long')) {
            return { start: next.start, dur: next.dur, ease: easeOutCubic };
        }
        return { start: line.end, dur: QUICK_FADE_DUR, ease: easeOutCubic };
    });

    // ------------------------------------------------------------------
    // Scrolling
    // ------------------------------------------------------------------

    // Scroll offset that centres `el`, including any ad-lib push currently
    // applied to it (offsetTop ignores transforms).
    function centerTop(el) {
        const containerH  = container.clientHeight;
        const elOffsetTop = el.offsetTop - scroller.offsetTop + (el._pushY || 0);
        return Math.max(0, elOffsetTop - containerH / 2 + el.offsetHeight / 2);
    }

    function scrollToLine(el, smooth = true) {
        if (!el) return;
        container.scrollTo({ top: centerTop(el), behavior: smooth ? 'smooth' : 'instant' });
    }

    function ensureGapLine(gap) {
        if (gapLineEl && gapLineData === gap) return;
        removeGapLine();

        gapLineEl = document.createElement('div');
        gapLineEl.className = 'ttml-line ttml-gap-line ttml-active';
        gapLineData = gap;

        const label = document.createElement('span');
        label.className = 'ttml-gap-label';
        label.textContent = `[${gap.label}]`;
        gapLineEl.appendChild(label);

        const bar = document.createElement('div');
        bar.className = 'ttml-gap-bar';
        gapLineEl.appendChild(bar);

        const afterEl = lineEls[gap.afterIdx + 1];
        if (afterEl) scroller.insertBefore(gapLineEl, afterEl);
        else         scroller.appendChild(gapLineEl);

        scrollToLine(gapLineEl);
    }

    function removeGapLine() {
        if (gapLineEl) { gapLineEl.remove(); gapLineEl = null; gapLineData = null; }
    }

    function updateGapBar(gap, t) {
        if (!gapLineEl) return;
        const bar = gapLineEl.querySelector('.ttml-gap-bar');
        if (!bar) return;
        const pct = Math.min(1, (t - gap.begin) / (gap.end - gap.begin)) * 100;
        bar.style.setProperty('--gap-pct', `${pct.toFixed(2)}%`);
    }

    let lastEntered = -2;    // last line whose entry schedule we've started
    let scrollAnim  = null;  // active medium/long scroll: { j, from, start, dur, ease }

    function updateScroll(t, inGap) {
        // The interstitial gap line owns scrolling while it is showing
        if (inGap) { scrollAnim = null; return; }

        let j = -1;
        for (let k = 0; k < entrySched.length; k++) {
            if (entrySched[k].start <= t) j = k;
        }

        if (j !== lastEntered) {
            lastEntered = j;
            if (j === -1) {
                scrollAnim = null;
                container.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const e = entrySched[j];
                const custom = e.mode === 'medium' || e.mode === 'long';
                if (custom && t < e.start + e.dur) {
                    scrollAnim = { j, from: container.scrollTop, start: e.start, dur: e.dur, ease: e.ease };
                } else {
                    scrollAnim = null;
                    scrollToLine(lineEls[j]);
                }
            }
        }

        if (scrollAnim) {
            const a = scrollAnim;
            const p = clamp01((t - a.start) / a.dur);
            // Target is re-read every frame so ad-lib pushes / reflow can't leave us off-centre
            const target = centerTop(lineEls[a.j]);
            container.scrollTo({ top: a.from + (target - a.from) * a.ease(p), behavior: 'instant' });
            if (p >= 1) scrollAnim = null;
        }
    }

    // ------------------------------------------------------------------
    // Lines
    // ------------------------------------------------------------------
    function setPush(el, y) {
        y = +y.toFixed(2);
        if (y === (el._pushY || 0)) return;
        el._pushY = y;
        el.style.transform = y ? `translateY(${y}px)` : '';
    }

    function updateLines(t) {
        let pushed = 0; // cumulative space borrowed by ad-lib rows of earlier lines

        if (gapLineEl && gapLineData.afterIdx === -1) setPush(gapLineEl, 0);

        for (let i = 0; i < lineEls.length; i++) {
            const el    = lineEls[i];
            const entry = entrySched[i];
            const exit  = exitSched[i];

            // Lines below an ad-lib shift down only while it is showing
            setPush(el, pushed);

            // idle -> active (highlighted, stays through hold + fade) -> past
            const exitEnd = exit.start + exit.dur;
            const state = t < entry.hlAt ? 'idle' : t < exitEnd ? 'active' : 'past';
            if (el._state !== state) {
                el._state = state;
                if (state === 'active') el.style.setProperty('--active-dur', `${entry.hlDur}s`);
                el.classList.toggle('ttml-active', state === 'active');
                el.classList.toggle('ttml-past',   state === 'past');
            }

            // Fade-out driven by the exit schedule
            const fp = exit.dur > 0 ? clamp01((t - exit.start) / exit.dur) : (t >= exit.start ? 1 : 0);
            const op = +(1 - exit.ease(fp)).toFixed(3);
            if (op !== el._op) {
                el._op = op;
                el.style.setProperty('--line-opacity', op);
            }

            // Main-line tokens: sweep + rise
            updateGroup(el.group, t);

            // Ad-lib rows: fade, stack, and report the room they occupy
            let stack = 0;
            for (const ar of el.adlibRowEls) {
                const a    = ar.adlib;
                const inP  = clamp01((t - a.showAt) / ADLIB_FADE);
                const outP = clamp01((t - a.hideAt) / ADLIB_FADE);
                const vis  = easeInOutCubic(inP) * (1 - easeInOutCubic(outP));

                const op2 = +(vis * ADLIB_OPACITY).toFixed(3);
                if (op2 !== ar.op) { ar.op = op2; ar.el.style.opacity = op2; }

                const ty = +stack.toFixed(2);
                if (ty !== ar.ty) { ar.ty = ty; ar.el.style.transform = `translateY(${ty}px)`; }

                if (vis > 0) {
                    if (ar.h === null) ar.h = ar.el.offsetHeight;
                    stack += ar.h * vis;
                }
                updateGroup(ar.group, t);
            }
            pushed += stack;

            if (gapLineEl && gapLineData.afterIdx === i) setPush(gapLineEl, pushed);
        }
    }

    function frame() {
        if (destroyed) return;
        const t = getCurrentTime();

        const activeGap = findActiveGap(t);
        if (activeGap) {
            ensureGapLine(activeGap);
            updateGapBar(activeGap, t);
        } else {
            removeGapLine();
        }

        updateLines(t);
        updateScroll(t, !!activeGap);

        rafId = requestAnimationFrame(frame);
    }

    // All visual state is derived from t each frame, so a seek only needs to
    // restart the scroll bookkeeping.
    function onSeeked() {
        scrollAnim  = null;
        lastEntered = -2;
    }

    // Cached ad-lib row heights go stale when the layout width changes
    const resizeObserver = new ResizeObserver(() => {
        lineEls.forEach(el => el.adlibRowEls.forEach(ar => { ar.h = null; }));
    });
    resizeObserver.observe(container);

    wavesurfer.on('seeking', onSeeked);
    rafId = requestAnimationFrame(frame);

    return {
        destroy() {
            destroyed = true;
            if (rafId) cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            wavesurfer.un('seeking', onSeeked);
            container.innerHTML = '';
        }
    };
}