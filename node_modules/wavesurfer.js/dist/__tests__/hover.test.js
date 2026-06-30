import HoverPlugin from '../plugins/hover.js';
import { signal } from '../reactive/store.js';
const createEmitter = () => {
    const listeners = new Map();
    return {
        on: jest.fn((event, listener) => {
            if (!listeners.has(event)) {
                listeners.set(event, new Set());
            }
            listeners.get(event).add(listener);
            return () => { var _a; return (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(listener); };
        }),
    };
};
const createWaveSurfer = (container, durationValue) => {
    const duration = signal(durationValue);
    Object.defineProperty(container, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, width: 100 }),
    });
    document.body.appendChild(container);
    return {
        duration,
        wavesurfer: Object.assign(Object.assign({}, createEmitter()), { options: { progressColor: '#555' }, getDuration: jest.fn(() => duration.value), getState: jest.fn(() => ({ duration })), getWrapper: jest.fn(() => container) }),
    };
};
describe('HoverPlugin', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });
    test('passes the current wavesurfer duration to formatTimeCallback', () => {
        var _a;
        const container = document.createElement('div');
        const formatTimeCallback = jest.fn((seconds) => `${seconds}`);
        const { wavesurfer } = createWaveSurfer(container, 0);
        const plugin = HoverPlugin.create({ formatTimeCallback });
        plugin._init(wavesurfer);
        wavesurfer.getDuration.mockReturnValue(12);
        container.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50 }));
        expect(formatTimeCallback).toHaveBeenCalledWith(6);
        expect((_a = container.querySelector('[part="hover-label"]')) === null || _a === void 0 ? void 0 : _a.textContent).toBe('6');
    });
    test('keeps the hover line hidden after pointerleave when duration updates', () => {
        const container = document.createElement('div');
        const formatTimeCallback = jest.fn((seconds) => `${seconds}`);
        const { duration, wavesurfer } = createWaveSurfer(container, 10);
        const plugin = HoverPlugin.create({ formatTimeCallback });
        plugin._init(wavesurfer);
        container.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50 }));
        const hover = container.querySelector('[part="hover"]');
        expect(hover === null || hover === void 0 ? void 0 : hover.style.opacity).toBe('1');
        expect(formatTimeCallback).toHaveBeenCalledTimes(1);
        container.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
        expect(hover === null || hover === void 0 ? void 0 : hover.style.opacity).toBe('0');
        // transform is cleared after the opacity transition ends, not immediately
        hover === null || hover === void 0 ? void 0 : hover.dispatchEvent(new Event('transitionend'));
        expect(hover === null || hover === void 0 ? void 0 : hover.style.transform).toBe('');
        duration.set(12);
        expect(hover === null || hover === void 0 ? void 0 : hover.style.opacity).toBe('0');
        expect(hover === null || hover === void 0 ? void 0 : hover.style.transform).toBe('');
        expect(formatTimeCallback).toHaveBeenCalledTimes(1);
    });
});
