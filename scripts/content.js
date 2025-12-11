/**
 * 内容脚本 - 快速验证、自动跳转、保活、清爽模式
 */

(function () {
    'use strict';

    // ========== 常量配置 ==========

    const DEFAULT_SETTINGS = {
        autoVerify: true,
        autoRedirect: true,
        keepalive: true,
        optimizeUI: true,
        privacyProtect: true,
        hotSearch: false,
        wideScreen: false
    };

    const VERIFY_TITLES = ['请稍候', '請稍候', 'Just a moment'];
    const SUCCESS_KEYWORDS = ['成功', 'success'];

    const MONITOR_TIMEOUT = 20000; // 验证超时
    const CHECK_INTERVAL = 300; // 检测间隔
    const CLICK_INTERVAL = 200; // 点击间隔
    const KEEPALIVE_INTERVAL = 5 * 60 * 1000; // 保活间隔

    let hasRequested = false;
    let startTime = 0;
    let clickCount = 0;
    let cachedApiVersion = null;

    // 动态获取 API 版本号
    async function getApiVersion() {
        if (cachedApiVersion) return cachedApiVersion;

        try {
            // 查找 platform-*.js（排除 platform-components）
            const links = document.querySelectorAll('link[rel="modulepreload"][href*="platform-"]:not([href*="platform-components"])');
            if (!links.length) {
                console.debug('[Helper] 未找到 platform-*.js');
                return '2.18';
            }

            const response = await fetch(links[0].href);
            const code = await response.text();

            // 匹配 const Un="x.xx"
            const match = code.match(/const \w+="(\d+\.\d+)",\w+="default"/);
            if (match) {
                cachedApiVersion = match[1];
                return cachedApiVersion;
            }
        } catch (e) {
            console.debug('[Helper] 获取版本号失败:', e);
        }

        return '2.18';
    }

    // ========== 辅助函数 ==========

    function needsVerification() {
        return VERIFY_TITLES.some(t => document.title.includes(t));
    }

    function isVerificationSuccess() {
        if (!needsVerification()) return true;

        const bodyText = document.body?.innerText || '';
        if (SUCCESS_KEYWORDS.some(k => bodyText.includes(k))) return true;

        const iframe = findChallengeElement();
        if (!iframe) return true;

        return false;
    }

    // ========== 自动验证 ==========

    function findChallengeElement() {
        const iframeSelectors = [
            'iframe[src*="challenges.cloudflare.com"]',
            'iframe[src*="turnstile"]',
            'iframe[title*="Cloudflare"]',
            'iframe[title*="cloudflare"]',
            'iframe[id*="cf-"]',
            'iframe[id*="cf-chl"]'
        ];

        for (const selector of iframeSelectors) {
            const iframe = document.querySelector(selector);
            if (iframe) return iframe;
        }

        const divSelectors = [
            'div[id^="cf-turnstile"]',
            'div[class*="cf-turnstile"]',
            'div[id^="tgnx"]',
            'div[id^="challenge"]'
        ];

        for (const selector of divSelectors) {
            const div = document.querySelector(selector);
            if (div) {
                const innerIframe = div.querySelector('iframe');
                if (innerIframe) return innerIframe;
                return div;
            }
        }

        const allIframes = document.querySelectorAll('iframe');
        for (const iframe of allIframes) {
            const src = iframe.src || '';
            const title = iframe.title || '';
            const id = iframe.id || '';
            if (src.includes('cloudflare') || src.includes('turnstile') ||
                title.toLowerCase().includes('cloudflare') || id.includes('cf-')) {
                return iframe;
            }
        }

        return null;
    }

    function getClickPosition(element) {
        const rect = element.getBoundingClientRect();
        const width = rect.right - rect.left;
        return {
            x: Math.round(rect.left + width * 0.03),
            y: Math.round(rect.top + (rect.bottom - rect.top) / 2)
        };
    }

    function requestDetach() {
        chrome.runtime.sendMessage({ action: 'detach' });
    }

    // 调试：在点击位置显示红点
    function showClickIndicator(x, y) {
        const indicatorId = 'pplx-helper-click-indicator';
        // 移除旧的红点
        document.getElementById(indicatorId)?.remove();

        const dot = document.createElement('div');
        dot.id = indicatorId;
        dot.style.cssText = `
            position: fixed;
            left: ${x - 8}px;
            top: ${y - 8}px;
            width: 16px;
            height: 16px;
            background: red;
            border-radius: 50%;
            z-index: 999999;
            pointer-events: none;
            box-shadow: 0 0 10px red;
        `;
        document.body.appendChild(dot);
        // 3秒后移除
        setTimeout(() => document.getElementById(indicatorId)?.remove(), 3000);
    }

    function requestClick(position) {
        clickCount++;
        console.debug(`[Helper] Click #${clickCount} at:`, position.x, position.y);

        // showClickIndicator(position.x, position.y);

        chrome.runtime.sendMessage({
            action: 'simulateClick',
            x: position.x,
            y: position.y
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Helper] Error:', chrome.runtime.lastError.message);
                return;
            }

            setTimeout(() => {
                if (isVerificationSuccess()) {
                    console.log('[Helper] Verification SUCCESS');
                    requestDetach();
                    return;
                }

                if (Date.now() - startTime > MONITOR_TIMEOUT) {
                    console.log('[Helper] 检测超时');
                    requestDetach();
                    if (needsVerification()) {
                        console.log('[Helper] 验证页面卡住了，刷新');
                        location.reload();
                    }
                    return;
                }
                requestClick(position);
            }, CLICK_INTERVAL);
        });
    }

    function checkAndRequest() {
        if (hasRequested) return;

        if (Date.now() - startTime > MONITOR_TIMEOUT) {
            console.log('[Helper] 检测超时');
            if (needsVerification()) {
                console.log('[Helper] 验证页面卡住了，刷新');
                location.reload();
            }
            return;
        }

        if (!needsVerification()) {
            return;
        }

        const element = findChallengeElement();
        if (element) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                hasRequested = true;
                const position = getClickPosition(element);
                console.log('[Helper] 检测到验证框');
                setTimeout(() => requestClick(position), 100);
                return;
            }
        }

        setTimeout(checkAndRequest, CHECK_INTERVAL);
    }

    function startMonitoring() {
        if (!needsVerification()) return;
        console.log('[Helper] 开始检测');
        startTime = Date.now();
        setTimeout(checkAndRequest, 500);
    }

    function initAutoVerify() {
        if (document.readyState === 'complete') {
            startMonitoring();
        } else {
            window.addEventListener('load', () => startMonitoring(), { once: true });
        }
    }

    // ========== 自动跳转验证 ==========

    function initAutoRedirect() {

        const RELOAD_COOLDOWN = 5000; // 5秒冷却
        const RELOAD_KEY = 'pplx_last_reload';

        function canReload() {
            const last = sessionStorage.getItem(RELOAD_KEY);
            if (!last) return true;
            return Date.now() - parseInt(last, 10) > RELOAD_COOLDOWN;
        }

        function doReload() {
            sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
            location.reload();
        }

        async function checkCFBlock() {
            if (needsVerification()) return;

            const version = await getApiVersion();

            // 使用 ping 接口检测
            fetch(`https://www.perplexity.ai/rest/ping?version=${version}&source=default`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'x-app-apiclient': 'default',
                    'x-app-apiversion': version
                }
            }).then(response => {
                console.debug('[Helper] ping 状态码', response.status);
                if (response.status === 403 && canReload()) {
                    console.log('[Helper] 检测到 CF 拦截，刷新页面');
                    doReload();
                }
            }).catch(() => { });
        }

        if (document.readyState === 'complete') {
            setTimeout(checkCFBlock, 1500);
        } else {
            window.addEventListener('load', () => setTimeout(checkCFBlock, 1500), { once: true });
        }
    }

    // ========== 定时保活 ==========

    function initKeepalive(autoRedirect) {
        async function sendPing() {
            const version = await getApiVersion();

            fetch(`https://www.perplexity.ai/rest/ping?version=${version}&source=default`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'x-app-apiclient': 'default',
                    'x-app-apiversion': version,
                    'x-perplexity-request-reason': 'keepalive'
                }
            }).then(response => {
                if (response.status === 403 && autoRedirect) {
                    console.log('[Helper] Keepalive 检测到 CF 拦截，刷新页面');
                    location.reload();
                    return;
                }
                console.debug('[Helper] Keepalive ping sent');
            }).catch(() => { });
        }

        function start() {
            if (needsVerification()) return;
            setInterval(sendPing, KEEPALIVE_INTERVAL);
            console.debug('[Helper] Keepalive started');
        }

        if (document.readyState === 'complete') {
            start();
        } else {
            window.addEventListener('load', () => start(), { once: true });
        }
    }

    // ========== 清爽模式 ==========

    function initOptimizeUI() {
        function injectHideStyles() {
            const style = document.createElement('style');
            style.textContent = `
                /* 隐藏通知按钮的父容器 */
                .relative.flex.flex-col.items-center.justify-center:has(use[*|href="#pplx-icon-bell"]) {
                    display: none !important;
                }
                /* 隐藏升级按钮 */
                button[data-testid="sidebar-upgrade-button"] {
                    display: none !important;
                }
                /* 隐藏安装按钮的父容器 */
                .gap-xs.flex.flex-col.items-center:has(use[*|href="#pplx-icon-download"]) {
                    display: none !important;
                }
                /* 隐藏 Logo（保留占位） */
                a[href="/"] use[href="#pplx-logo-mark"] {
                    visibility: hidden !important;
                }
                /* 侧边栏按钮区域垂直居中 */
                .scrollbar-none.relative.min-h-0.w-full.flex-1.overflow-y-auto {
                    flex: 0 1 auto !important;
                    margin: auto 0 !important;
                }
                /* 隐藏广告横幅 */
                .h-bannerHeight:has(use[*|href="#pplx-icon-sparkles"]) {
                    display: none !important;
                }
                /* 隐藏输入框下方的快捷按钮（分析、总结等） */
                .mt-lg.absolute.w-full:has(.animate-in.fade-in) {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        if (document.head) {
            injectHideStyles();
        } else {
            document.addEventListener('DOMContentLoaded', injectHideStyles);
        }
    }

    // ========== 宽屏模式 ==========

    function initWideScreen() {
        function injectWideStyles() {
            const style = document.createElement('style');
            style.id = 'pplx-widescreen';
            style.textContent = `
                /* 移除内容区域宽度限制 */
                .max-w-threadContentWidth {
                    max-width: none !important;
                    padding-left: 5vw !important;
                    padding-right: 5vw !important;
                }
            `;
            document.head.appendChild(style);
        }

        if (document.head) {
            injectWideStyles();
        } else {
            document.addEventListener('DOMContentLoaded', injectWideStyles);
        }
    }

    // ========== 模块：隐私保护、热门搜索 ==========

    function initInjectSettings(privacyProtect, hotSearch) {
        // 向页面发送设置给 inject.js
        window.postMessage({ type: 'PPLX_SETTINGS', privacyProtect, hotSearch }, '*');
    }

    // ========== 插件配置 ==========

    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        // 传递设置给 inject.js
        initInjectSettings(settings.privacyProtect, settings.hotSearch);

        if (settings.autoVerify) {
            initAutoVerify();
        }

        if (settings.autoRedirect) {
            initAutoRedirect();
        }

        if (settings.keepalive) {
            initKeepalive(settings.autoRedirect);
        }

        if (settings.optimizeUI) {
            initOptimizeUI();
        }

        if (settings.wideScreen) {
            initWideScreen();
        }
    });

    // 监听设置变化，清爽模式、宽屏模式变化时刷新
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.optimizeUI || changes.wideScreen)) {
            location.reload();
        }
    });

})();
