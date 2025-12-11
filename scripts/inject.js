/**
 * 页面注入脚本 - Hook 网络请求
 */

(function () {
    'use strict';

    let privacyProtectEnabled = true; // 隐私保护
    let hotSearchEnabled = false; // 热门搜索

    // 监听来自 content.js 的设置
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'PPLX_SETTINGS') {
            privacyProtectEnabled = event.data.privacyProtect;
            hotSearchEnabled = event.data.hotSearch;
        }
    });

    // ========== Hook fetch ========== 

    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
        // 获取实际 URL
        let url = '';
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof URL) {
            url = input.href;
        } else if (input instanceof Request) {
            url = input.url;
        }

        // Hook autosuggest API - 返回空结果
        if (!hotSearchEnabled && url.includes('/rest/autosuggest/')) {
            return new Response(JSON.stringify({ results: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 如果隐私保护关闭，放行其余请求
        if (!privacyProtectEnabled) {
            return originalFetch.call(this, input, init);
        }

        // Hook Perplexity Analytics
        if (url.includes('/rest/event/analytics')) {
            return new Response(JSON.stringify({
                accepted_events: 1,
                rejected_events: 0,
                status: 'completed',
                total_events: 1
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Hook Datadog RUM
        if (url.includes('browser-intake-datadoghq.com/')) {
            const urlObj = new URL(url);
            const requestId = urlObj.searchParams.get('dd-request-id') || crypto.randomUUID();
            return new Response(JSON.stringify({ request_id: requestId }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Hook Singular SDK
        if (url.includes('sdk-api-v1.singular.net/')) {
            return new Response(JSON.stringify({ status: 'ok' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 其他请求正常处理
        return originalFetch.call(this, input, init);
    };

    window.fetch.toString = originalFetch.toString.bind(originalFetch);

    // ========== Hook sendBeacon ==========

    const originalSendBeacon = navigator.sendBeacon.bind(navigator);

    navigator.sendBeacon = function (url, data) {
        if (!privacyProtectEnabled) {
            return originalSendBeacon(url, data);
        }

        // 拦截 analytics 请求
        if (url.includes('/rest/event/analytics') ||
            url.includes('browser-intake-datadoghq.com') ||
            url.includes('sdk-api-v1.singular.net')) {
            return true; // 假装发送成功
        }

        return originalSendBeacon(url, data);
    };

    navigator.sendBeacon.toString = () => 'function sendBeacon() { [native code] }';

    // ========== Hook XMLHttpRequest ==========

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        this._hookUrl = url;
        return originalXHROpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function (body) {
        // 如果隐私保护关闭，直接放行
        if (!privacyProtectEnabled) {
            return originalXHRSend.call(this, body);
        }

        const url = this._hookUrl || '';

        // Hook Singular SDK
        if (url.includes('sdk-api-v1.singular.net/')) {
            Object.defineProperty(this, 'readyState', { value: 4, writable: false });
            Object.defineProperty(this, 'status', { value: 200, writable: false });
            Object.defineProperty(this, 'responseText', { value: '{"status":"ok"}', writable: false });
            Object.defineProperty(this, 'response', { value: '{"status":"ok"}', writable: false });

            setTimeout(() => {
                if (this.onreadystatechange) this.onreadystatechange();
                if (this.onload) this.onload();
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('loadend'));
            }, 0);
            return;
        }

        return originalXHRSend.call(this, body);
    };

    XMLHttpRequest.prototype.open.toString = () => 'function open() { [native code] }';
    XMLHttpRequest.prototype.send.toString = () => 'function send() { [native code] }';
})();
