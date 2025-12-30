/**
 * 页面注入脚本 - Hook 网络请求
 */

(function () {
    'use strict';

    let privacyProtectEnabled = true; // 隐私保护
    let hotSearchEnabled = false; // 热门搜索
    let downgradeCheckEnabled = false; // 降智检测

    // 监听来自 content.js 的设置
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'PPLX_SETTINGS') {
            privacyProtectEnabled = event.data.privacyProtect;
            hotSearchEnabled = event.data.hotSearch;
            downgradeCheckEnabled = event.data.downgradeCheck;
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

        // Hook SSE 流式响应 - perplexity_ask
        if (url.includes('/rest/sse/perplexity_ask')) {

            // ================= 修复请求参数开始 =================
            try {

                if (init && typeof init.body === 'string') {
                    const bodyObj = JSON.parse(init.body);
                    
                    if (bodyObj && bodyObj.params) {
                        let modified = false;
                        // 1. 核心修复：将 source 从 "default" 改为 "entropy"
                        if (bodyObj.params.source === 'default') {
                            bodyObj.params.source = 'entropy';
                            modified = true;
                        }
                        // // 2. 修复搜索能力：开启 local_search_enabled
                        // if (bodyObj.params.local_search_enabled === false) {
                        //     bodyObj.params.local_search_enabled = true;
                        //     modified = true;
                        // }
                        // 3. 添加 comet_info，伪装成comet浏览器
                        // if (!bodyObj.params.comet_info) {
                        //     bodyObj.params.comet_info = {
                        //         "rendering_place": "tab"
                        //     };
                        //     modified = true;
                        // }
                        // 如果有修改，重新序列化 body
                        if (modified) {
                            init.body = JSON.stringify(bodyObj);
                        }
                    }
                }
            } catch (e) {
                console.error('perplexity_ask 修改请求参数失败', e);
            }
            // ================= 修复请求参数结束 =================

            const response = await originalFetch.call(this, input, init);
            
            if (!downgradeCheckEnabled) {
                return response;
            }
            
            // 检查是否是 SSE 响应
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/event-stream')) {
                return response;
            }

            // 创建 TransformStream 来处理流式数据
            let buffer = '';
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            const transformStream = new TransformStream({
                transform(chunk, controller) {
                    const text = decoder.decode(chunk, { stream: true });
                    buffer += text;

                    const lines = buffer.split('\n');
                    // Keep the last part in the buffer as it might be incomplete
                    buffer = lines.pop();

                    if (lines.length === 0) {
                        return;
                    }

                    const modifiedLines = lines.map(line => {
                        if (!line.startsWith('data: ')) return line;

                        const jsonStr = line.slice(6); // Remove "data: "
                        if (!jsonStr.trim()) return line;

                        try {
                            const data = JSON.parse(jsonStr);

                            // Only process final messages
                            if (!data.final_sse_message || !data.user_selected_model || !data.display_model) {
                                return line;
                            }

                            // Condition: user_selected_model !== "best" and display_model !== user_selected_model
                            if (data.user_selected_model === 'best' ||
                                data.display_model === data.user_selected_model) {
                                return line;
                            }

                            // Modify blocks array
                            // Compose warning message with model IDs
                            const warningMessage = `## **Fucking Perplexity** \n\n&nbsp;\n你选择的 \`${data.user_selected_model}\` 模型被降级到了 \`${data.display_model}\`，点击 **重写** 恢复正常`;

                            if (Array.isArray(data.blocks)) {
                                for (const block of data.blocks) {
                                    if ((block.intended_usage === 'ask_text_0_markdown' || block.intended_usage === 'ask_text') && block.markdown_block) {
                                        block.markdown_block.answer = warningMessage;
                                        block.markdown_block.chunks = [warningMessage];
                                    }
                                }
                            }

                            return 'data: ' + JSON.stringify(data);
                        } catch (e) {
                            return line;
                        }
                    });

                    // Add the newline back that was removed by split
                    controller.enqueue(encoder.encode(modifiedLines.join('\n') + '\n'));
                },
                flush(controller) {
                    if (buffer) {
                        controller.enqueue(encoder.encode(buffer));
                    }
                }
            });

            // 返回新的 Response，带有修改后的流
            return new Response(response.body.pipeThrough(transformStream), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
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
