/**
 * Popup 脚本
 */

const SETTINGS = {
    keys: ['autoVerify', 'autoRedirect', 'keepalive', 'optimizeUI', 'privacyProtect', 'hotSearch', 'wideScreen', 'downgradeCheck'],
    defaults: {
        autoVerify: true,
        autoRedirect: true,
        keepalive: true,
        optimizeUI: true,
        privacyProtect: true,
        hotSearch: false,
        wideScreen: false,
        downgradeCheck: false
    }
};

class PopupManager {
    constructor() {
        this.init();
    }

    async init() {
        this.loadVersion();
        await this.loadSettings();
        this.bindEvents();
        this.updateStatus();
        this.hasCheckedVersion = false; // 标记是否已检查更新
    }

    loadVersion() {
        const manifest = chrome.runtime.getManifest();
        const versionEl = document.getElementById('version');
        if (versionEl) {
            versionEl.textContent = `build ${manifest.version}`;
        }
    }

    async loadSettings() {
        try {
            // 加载时禁用过渡动画
            document.body.classList.add('no-transition');

            const result = await chrome.storage.sync.get(SETTINGS.defaults);
            SETTINGS.keys.forEach(key => {
                const element = document.getElementById(key);
                if (element) {
                    element.checked = result[key];
                }
            });

            // 恢复过渡动画
            requestAnimationFrame(() => {
                document.body.classList.remove('no-transition');
            });
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    bindEvents() {
        // 绑定开关
        SETTINGS.keys.forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                element.addEventListener('change', (e) => this.handleSettingChange(key, e.target.checked));
            }
        });

        // 绑定标签切换
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 移除所有激活状态
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                // 激活当前标签
                tab.classList.add('active');

                // 显示内容
                const tabId = tab.dataset.tab;
                document.getElementById(`tab-${tabId}`).classList.add('active');

                // 只有切换到"其他"tab时才检查一次更新
                if (tabId === 'more' && !this.hasCheckedVersion) {
                    this.hasCheckedVersion = true;
                    this.checkVersion();
                }
            });
        });

        // 绑定更新链接
        const updateLink = document.getElementById('checkUpdate');
        if (updateLink) {
            updateLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.checkForUpdates();
            });
        }
    }

    async handleSettingChange(key, value) {
        try {
            await chrome.storage.sync.set({ [key]: value });
        } catch (error) {
            console.error('Failed to save setting:', error);
        }
    }

    updateStatus() {
        // 更新状态指示器
        const indicator = document.querySelector('.status-indicator');
        if (indicator) {
            indicator.title = 'Extension is active';
        }
    }

    checkVersion() {
        const manifest = chrome.runtime.getManifest();
        const localVersion = manifest.version;
        const versionEl = document.getElementById('version');

        // 转换版本号为数字 (1.0.2 -> 102)
        const versionToNumber = (v) => parseInt(v.replace(/\D/g, ''), 10);

        fetch('https://api.github.com/repos/MasterDevYY/pplx-helper/releases/latest')
            .then(res => {
                if (res.status !== 200) return null;
                return res.json();
            })
            .then(data => {
                if (!data || !data.tag_name) return;

                const remoteVersion = data.tag_name.replace('v', '');
                const localNum = versionToNumber(localVersion);
                const remoteNum = versionToNumber(remoteVersion);

                if (remoteNum > localNum && versionEl) {
                    versionEl.textContent = `有新版本 v${remoteVersion}`;
                    versionEl.style.color = 'var(--accent-color)';
                }
            })
            .catch(() => { });
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
