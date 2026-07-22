// ttml-renderer.js
// Parses Apple Music TTML and drives a lyric display inside .ttml-container

const GAP_THRESHOLD = 5;     // seconds — gaps longer than this get an interstitial line
const ADLIB_PRE     = 0.5;   // seconds before first adlib token to show the row
const ADLIB_POST    = 0.5;   // seconds after last adlib token to hide the row

/**
 * Standard ease-out-cubic -- used for the token/letter "rise" animation and
 * the ad-lib font-size grow.
 */
function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
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

    // Median main-line word duration, used to decide which words are "long"
    // enough to get the letter-by-letter rise instead of rising as a whole.
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
                    // Keep adjacent no-space tokens from splitting across lines.
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

        // Adlib rows — hidden by default, shown/hidden independently in the RAF loop
        el.adlibRowEls = line.adlibs.map(adlib => {
            const row = document.createElement('div');
            row.className = 'ttml-adlib-row ttml-adlib-hidden';
            adlib.tokens.forEach((token, ti) => {
                if (ti > 0 && token.spaceBefore) row.appendChild(document.createTextNode(' '));
                const span = document.createElement('span');
                span.className = 'ttml-token ttml-adlib-token';
                span.textContent = token.text;
                span.dataset.begin = token.begin;
                span.dataset.end   = token.end;
                row.appendChild(span);
            });
            el.appendChild(row);
            return { el: row, adlib };
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

    // Returns the set of line indices currently active (begin <= t < end)
    function findActiveIndices(t) {
        const active = new Set();
        for (let i = 0; i < lines.length; i++) {
            if (t >= lines[i].begin && t < lines[i].end) active.add(i);
        }
        return active;
    }

    function findActiveGap(t) {
        for (const gap of gaps) {
            if (t >= gap.begin && t < gap.end) return gap;
        }
        return null;
    }

    function getTransitionDuration(lineIdx) {
        const nextBegin = lines[lineIdx + 1]?.begin ?? (lines[lineIdx].end + 0.5);
        return Math.max(0.5, nextBegin - lines[lineIdx].end);
    }

    // Returns the "leaf" elements that should be animated/swept for a given
    // top-level main-row token span -- either the letters of a split long
    // word, or the token span itself.
    function getMainLeaves(tokEl) {
        return tokEl.classList.contains('ttml-token--split')
            ? Array.from(tokEl.querySelectorAll('.ttml-letter'))
            : [tokEl];
    }

    // Vertical "rise" offset for a main-line token/letter.
    // Normal tokens animate from 4px to 0px, long-word letters animate from
    // 0px to -4px over their own [begin, end] window as they're sung.
    function updateRise(el, t) {
        const begin = parseFloat(el.dataset.begin);
        const end   = parseFloat(el.dataset.end);
        const isLongLeaf = el.classList.contains('ttml-letter');
        let offsetPx;
        if (isLongLeaf) {
            if (t <= begin) {
                offsetPx = 4;
            } else if (t >= end) {
                offsetPx = 0;
            } else {
                const progress = (t - begin) / (end - begin);
                offsetPx = 4 * easeOutCubic(progress);
            }
        } else {
            if (t <= begin) {
                offsetPx = 4;
            } else if (t >= end) {
                offsetPx = 0;
            } else {
                const progress = (t - begin) / (end - begin);
                offsetPx = 4 * (1 - easeOutCubic(progress));
            }
        }
        el.style.transform = `translateY(${offsetPx.toFixed(2)}px)`;
    }

    function updateMainLeaf(el, t) {
        updateSweep(el, t);
        updateRise(el, t);
    }

    // Font-size for an ad-lib token: 90% while unsung, easing to 100% over
    // its own [begin, end] window as it's sung.
    function updateAdlibScale(tokenEl, t) {
        const begin = parseFloat(tokenEl.dataset.begin);
        const end   = parseFloat(tokenEl.dataset.end);
        let scale;
        if (t <= begin) {
            scale = 90;
        } else if (t >= end) {
            scale = 100;
        } else {
            const progress = (t - begin) / (end - begin);
            scale = 90 + easeOutCubic(progress) * 10;
        }
        tokenEl.style.fontSize = `${scale.toFixed(2)}%`;
    }

    function updateSweep(tokenEl, t) {
        const begin = parseFloat(tokenEl.dataset.begin);
        const end   = parseFloat(tokenEl.dataset.end);
        if (t >= end) {
            tokenEl.style.setProperty('--sweep-pct', '100%');
        } else if (t <= begin) {
            tokenEl.style.setProperty('--sweep-pct', '0%');
        } else {
            const pct = ((t - begin) / (end - begin)) * 100;
            tokenEl.style.setProperty('--sweep-pct', `${pct.toFixed(2)}%`);
        }
    }

    function scrollToLine(el, smooth = true) {
        if (!el) return;
        const containerH  = container.clientHeight;
        const elOffsetTop = el.offsetTop - scroller.offsetTop;
        const target = elOffsetTop - containerH / 2 + el.offsetHeight / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'instant' });
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

    let lastScrollTarget = -1; // track which line we last scrolled to

    function frame() {
        if (destroyed) return;
        const t = getCurrentTime();

        // --- Gap interstitial ---
        const activeGap = findActiveGap(t);
        if (activeGap) {
            ensureGapLine(activeGap);
            updateGapBar(activeGap, t);
            lineEls.forEach(el => el.classList.remove('ttml-active', 'ttml-past'));
            rafId = requestAnimationFrame(frame);
            return;
        } else {
            removeGapLine();
        }

        // --- Real lines ---
        const activeIndices = findActiveIndices(t);

        // Scroll to the first newly-active line (lowest index)
        const firstActive = activeIndices.size > 0 ? Math.min(...activeIndices) : -1;
        if (firstActive !== -1 && firstActive !== lastScrollTarget) {
            scrollToLine(lineEls[firstActive]);
            lastScrollTarget = firstActive;
        }
        if (activeIndices.size === 0) lastScrollTarget = -1;

        lineEls.forEach((el, i) => {
            const line = lines[i];
            const isActive = activeIndices.has(i);
            const isPast   = t >= line.end;

            // --- Main line state ---
            if (isActive) {
                if (!el.classList.contains('ttml-active')) {
                    el.classList.add('ttml-active');
                    el.classList.remove('ttml-past');
                    el.style.setProperty('--active-dur', `${getTransitionDuration(i)}s`);
                }
                el.mainRow.querySelectorAll('.ttml-token').forEach(tok => {
                    getMainLeaves(tok).forEach(leaf => updateMainLeaf(leaf, t));
                });
            } else if (isPast) {
                if (!el.classList.contains('ttml-past')) {
                    el.classList.add('ttml-past');
                    el.classList.remove('ttml-active');
                    el.mainRow.querySelectorAll('.ttml-token').forEach(tok => {
                        getMainLeaves(tok).forEach(leaf => {
                            leaf.style.setProperty('--sweep-pct', '100%');
                            leaf.style.transform = 'translateY(0px)';
                        });
                    });
                }
            } else {
                el.classList.remove('ttml-active', 'ttml-past');
                el.mainRow.querySelectorAll('.ttml-token').forEach(tok => {
                    getMainLeaves(tok).forEach(leaf => {
                        leaf.style.setProperty('--sweep-pct', '0%');
                        leaf.style.transform = 'translateY(4px)';
                    });
                });
            }

            // --- Adlib rows — each governed independently ---
            el.adlibRowEls.forEach(({ el: row, adlib }) => {
                const visible = t >= adlib.showAt && t < adlib.hideAt;

                if (visible) {
                    row.classList.remove('ttml-adlib-hidden');
                    // Sweep + grow adlib tokens on their own timeline
                    row.querySelectorAll('.ttml-token').forEach(tok => {
                        updateSweep(tok, t);
                        updateAdlibScale(tok, t);
                    });
                } else {
                    row.classList.add('ttml-adlib-hidden');
                    // Reset sweep/size to the appropriate edge so it's ready when it appears
                    row.querySelectorAll('.ttml-token').forEach(tok => {
                        const tb = parseFloat(tok.dataset.begin);
                        const te = parseFloat(tok.dataset.end);
                        const sung = t >= te;
                        tok.style.setProperty('--sweep-pct', sung ? '100%' : '0%');
                        tok.style.fontSize = sung ? '100%' : '90%';
                    });
                }
            });
        });

        rafId = requestAnimationFrame(frame);
    }

    function onSeeked() {
        lineEls.forEach(el => {
            el.classList.remove('ttml-active', 'ttml-past');
            el.adlibRowEls.forEach(({ el: row }) => row.classList.add('ttml-adlib-hidden'));
        });
        lastScrollTarget = -1;
    }

    wavesurfer.on('seeking', onSeeked);
    rafId = requestAnimationFrame(frame);

    return {
        destroy() {
            destroyed = true;
            if (rafId) cancelAnimationFrame(rafId);
            wavesurfer.un('seeking', onSeeked);
            container.innerHTML = '';
        }
    };
}