var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function watchProgress(response, progressCallback, signal) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!response.body || !response.headers)
            return;
        const reader = response.body.getReader();
        const contentLength = Number(response.headers.get('Content-Length')) || 0;
        let receivedLength = 0;
        // Abort the reader when the signal fires
        const onAbort = () => {
            reader.cancel();
        };
        if (signal) {
            if (signal.aborted) {
                reader.cancel();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        // Use iteration instead of recursion to avoid stack issues
        try {
            while (true) {
                const data = yield reader.read();
                if (data.done) {
                    break;
                }
                receivedLength += ((_a = data.value) === null || _a === void 0 ? void 0 : _a.length) || 0;
                // Only report progress if Content-Length is available and non-zero
                if (contentLength > 0) {
                    const percentage = Math.round((receivedLength / contentLength) * 100);
                    progressCallback(percentage);
                }
            }
        }
        catch (err) {
            // Ignore abort errors from reader cancellation
            if (err instanceof DOMException && err.name === 'AbortError')
                return;
            // Ignore other errors because we can only handle the main response
            console.warn('Progress tracking error:', err);
        }
        finally {
            // Remove the abort listener to prevent leaks
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        }
    });
}
function fetchBlob(url, progressCallback, requestInit) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Fetch the resource
        const response = yield fetch(url, requestInit);
        if (response.status >= 400) {
            throw new Error(`Failed to fetch ${url}: ${response.status} (${response.statusText})`);
        }
        // Read the data to track progress
        // Pass the abort signal so the progress reader can be cancelled
        watchProgress(response.clone(), progressCallback, (_a = requestInit === null || requestInit === void 0 ? void 0 : requestInit.signal) !== null && _a !== void 0 ? _a : undefined);
        return response.blob();
    });
}
const Fetcher = {
    fetchBlob,
};
export default Fetcher;
