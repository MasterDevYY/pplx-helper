/**
 * 后台脚本 - 模拟点击
 */

let attachedTabId = null;
let isClicking = false;

async function simulateMouseClick(tabId, x, y) {
    if (isClicking && attachedTabId === tabId) {
        try {
            const clickX = Math.round(x + (Math.random() - 0.5) * 2);
            const clickY = Math.round(y + (Math.random() - 0.5) * 2);

            await chrome.debugger.sendCommand({ tabId }, 'Input.synthesizeTapGesture', {
                x: clickX,
                y: clickY,
                duration: randomInt(50, 100),
                tapCount: 1,
                gestureSourceType: 'mouse'
            });

            return { success: true, x: clickX, y: clickY };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    isClicking = true;

    try {
        if (attachedTabId !== tabId) {
            try { await chrome.debugger.detach({ tabId }); } catch (e) { }
            await chrome.debugger.attach({ tabId }, '1.3');
            attachedTabId = tabId;
            console.log('[Background] Debugger attached to tab', tabId);
        }

        const clickX = Math.round(x + (Math.random() - 0.5) * 2);
        const clickY = Math.round(y + (Math.random() - 0.5) * 2);

        console.log('[Background] Clicking at', clickX, clickY);

        await chrome.debugger.sendCommand({ tabId }, 'Input.synthesizeTapGesture', {
            x: clickX,
            y: clickY,
            duration: randomInt(50, 100),
            tapCount: 1,
            gestureSourceType: 'mouse'
        });

        return { success: true, x: clickX, y: clickY };
    } catch (error) {
        console.error('[Background] Error:', error);
        isClicking = false;
        return { success: false, error: error.message };
    }
}

async function detachDebugger(tabId) {
    if (attachedTabId !== tabId) return;
    try {
        await chrome.debugger.detach({ tabId });
        console.log('[Background] Debugger detached from tab', tabId);
    } catch (e) { }
    if (attachedTabId === tabId) {
        attachedTabId = null;
        isClicking = false;
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'simulateClick' && sender.tab) {
        simulateMouseClick(sender.tab.id, message.x, message.y)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.action === 'detach' && sender.tab) {
        detachDebugger(sender.tab.id);
        sendResponse({ success: true });
        return false;
    }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0 && attachedTabId === details.tabId) {
        console.log('[Background] Page navigating, detaching...');
        detachDebugger(details.tabId);
    }
});

console.log('[Background] service worker started');