

(function () {
    console.log('[FlipHelper Debug] content.js IIFE executed');
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('data-cfasync', 'false');
    scriptEl.src = chrome.runtime.getURL('inject.js');
    (document.head || document.documentElement).appendChild(scriptEl);
    setTimeout(() => {
        scriptEl.remove();
    }, 1000);

    // Block role="status" notifications dynamically as they spawn
    const blockStatusElements = (rootNode) => {
        if (!rootNode) return;
        const elements = rootNode.querySelectorAll ? rootNode.querySelectorAll('[role="status"]') : [];
        elements.forEach(el => {
            el.style.setProperty('display', 'none', 'important');
        });
        if (rootNode.getAttribute && rootNode.getAttribute('role') === 'status') {
            rootNode.style.setProperty('display', 'none', 'important');
        }
    };

    const statusObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    blockStatusElements(node);
                }
            }
        }
    });

    statusObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    blockStatusElements(document);

    let lastApiNotifTime = 0;
    const scriptStartTime = Date.now();

    let activeBetAmount = null;
    let expectedBalance = null;

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        console.log('[FlipHelper Debug] content.js message event received:', event.data.type, event.data);

        if (event.data.type === 'FH_URL_CHANGE') {
            updatePageSupport();
            return;
        }

        if (event.data.type === 'FH_ALL_IN_WARNING') {
            console.log('[FlipHelper Debug] FH_ALL_IN_WARNING triggered for balance:', event.data.balance);
            currentAllInReqId = event.data.reqId;
            const bal = event.data.balance;

            const usd = (bal * 0.002).toFixed(2);
            const roc = (bal / 1.5).toFixed(0);

            warningConversions.innerHTML = `
                <div style="line-height: 1.6; font-family: 'Inter', sans-serif;">${bal.toFixed(2)} balance is <span class="fh-val-usd">$${usd}</span></div>
                <div style="line-height: 1.6; color: #999999; font-family: 'Inter', sans-serif; font-size: 13px; margin-top: 4px;">${bal.toFixed(2)} balance is <span class="fh-val-roc">${roc} robux</span></div>
            `;

            warningOverlay.classList.add('visible');
            btnGo.disabled = true;
            btnGo.textContent = "Wait (5s)...";

            let timeLeft = 5;
            clearInterval(allInCountdownInterval);
            allInCountdownInterval = setInterval(() => {
                timeLeft--;
                console.log('[FlipHelper Debug] Warning overlay countdown tick remaining:', timeLeft);
                if (timeLeft <= 0) {
                    clearInterval(allInCountdownInterval);
                    btnGo.disabled = false;
                    btnGo.textContent = "Go Ahead";
                } else {
                    btnGo.textContent = `Wait (${timeLeft}s)...`;
                }
            }, 1000);
            return;
        }

        if (event.data.type === 'FH_BALANCE_UPDATE') {
            const apiBal = event.data.balance;
            const currency = event.data.currency;
            console.log('[FlipHelper Receiver] FH_BALANCE_UPDATE received:', apiBal, 'currency:', currency);
            if (apiBal !== null && typeof apiBal === 'number') {
                if (activeCurrency !== null && currency !== activeCurrency) {
                    console.log(`[FlipHelper Receiver] Ignoring FH_BALANCE_UPDATE for ${currency} because activeCurrency is ${activeCurrency}`);
                    return;
                }
                updateProfitFromBalance(apiBal);
            }
            return;
        }

        if (event.data.type !== 'FH_GAME_ACTION') {
            console.log('[FlipHelper Debug] Message event type ignored in content.js:', event.data.type);
            return;
        }

        const payload = event.data;
        lastApiNotifTime = Date.now();

        console.log('[FlipHelper Receiver] FH_GAME_ACTION received:', payload.action, 'Amount:', payload.amount);

        if (payload.action === 'bet') {
            if (payload.amount < 0.10) return;
            activeBetAmount = payload.amount;
            expectedBalance = lastKnownBalance !== null ? lastKnownBalance - payload.amount : null;
            isBetActive = true;
            wagered += payload.amount;
            if (isContextValid()) {
                chrome.storage.local.set({ wagered });
            }
            console.log('[FlipHelper Debug] FH_GAME_ACTION action: bet, updated activeBetAmount:', activeBetAmount, 'expectedBalance:', expectedBalance);
            if (expectedBalance !== null) {
                updateProfitFromBalance(expectedBalance, true);
            }
            if (settings.notifications.bet) {
                showNotification(`BET: ${Number(payload.amount).toFixed(2)}`, 'bet');
            }
        } else if (payload.action === 'win') {
            if (payload.amount < 0.10) return;
            expectedBalance = lastKnownBalance !== null ? lastKnownBalance + payload.amount : null;
            isBetActive = false;
            pendingHistoryPush = true;
            wins += 1;
            if (isContextValid()) {
                chrome.storage.local.set({ wins });
            }
            console.log('[FlipHelper Debug] FH_GAME_ACTION action: win, updated expectedBalance:', expectedBalance, 'pendingHistoryPush:', pendingHistoryPush);
            if (expectedBalance !== null) {
                updateProfitFromBalance(expectedBalance, true);
            }
            if (settings.notifications.win) {
                showNotification(`WIN: +${Number(payload.amount).toFixed(2)}`, 'win');
            }
            activeBetAmount = null;
        } else if (payload.action === 'loss') {
            const lossAmount = payload.amount || activeBetAmount || 0;
            if (lossAmount < 0.10) return;
            expectedBalance = lastKnownBalance;
            isBetActive = false;
            pendingHistoryPush = true;
            losses += 1;
            if (isContextValid()) {
                chrome.storage.local.set({ losses });
            }
            console.log('[FlipHelper Debug] FH_GAME_ACTION action: loss, updated expectedBalance:', expectedBalance, 'pendingHistoryPush:', pendingHistoryPush);
            if (expectedBalance !== null) {
                updateProfitFromBalance(expectedBalance, true);
            }
            if (settings.notifications.loss) {
                showNotification(`LOSS${lossAmount ? ': ' + Number(lossAmount).toFixed(2) : ''}`, 'loss');
            }
            activeBetAmount = null;
        }
    });

    const warningOverlayHTML = `
        <div id="fh-warning-overlay" style="font-family: 'Inter', sans-serif;">
            <div class="fh-warning-box-wrapper" id="fh-warning-wrapper">
                <div class="fh-warning-box">
                    <div class="fh-warning-header">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <div class="fh-warning-header-title">Warning</div>
                    </div>
                    <div class="fh-warning-content">
                        <div class="fh-warning-text">You are attempting to bet 80% or more of your balance, <span class="fh-think-bigger">think about it.</span></div>
                        <div class="fh-warning-subtext" id="fh-warning-conversions"></div>
                        <div class="fh-warning-actions">
                            <button class="fh-btn-danger" id="fh-btn-stop">Stop Bet</button>
                            <button class="fh-btn-secondary" id="fh-btn-go" disabled>Wait (5s)...</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const warningContainer = document.createElement('div');
    warningContainer.innerHTML = warningOverlayHTML;
    document.body.appendChild(warningContainer.firstElementChild);

    const warningOverlay = document.getElementById('fh-warning-overlay');
    const warningWrapper = document.getElementById('fh-warning-wrapper');
    const warningConversions = document.getElementById('fh-warning-conversions');
    const btnStop = document.getElementById('fh-btn-stop');
    const btnGo = document.getElementById('fh-btn-go');

    let currentAllInReqId = null;
    let allInCountdownInterval = null;

    warningOverlay.addEventListener('click', (e) => {
        console.log('[FlipHelper Debug] Warning overlay clicked');
        if (e.target === warningOverlay) {
            console.log('[FlipHelper Debug] Warning overlay target matches, triggering vibrate');
            warningWrapper.classList.remove('vibrate');
            void warningWrapper.offsetWidth;
            warningWrapper.classList.add('vibrate');
        }
    });

    btnStop.addEventListener('click', () => {
        console.log('[FlipHelper Debug] Warning Stop button clicked');
        if (currentAllInReqId) {
            window.postMessage({ type: 'FH_ALL_IN_RESPONSE', reqId: currentAllInReqId, action: 'REJECT' }, '*');
        }
        closeWarning();
    });

    btnGo.addEventListener('click', () => {
        console.log('[FlipHelper Debug] Warning Go button clicked');
        if (btnGo.disabled) {
            console.log('[FlipHelper Debug] Go button is disabled, ignoring click');
            return;
        }
        if (currentAllInReqId) {
            window.postMessage({ type: 'FH_ALL_IN_RESPONSE', reqId: currentAllInReqId, action: 'ALLOW' }, '*');
        }
        closeWarning();
    });

    function closeWarning() {
        console.log('[FlipHelper Debug] closeWarning called');
        warningOverlay.classList.remove('visible');
        currentAllInReqId = null;
        clearInterval(allInCountdownInterval);
    }

    let startingBalance = null;
    let currentBalance = null;
    let activeCurrency = null;
    let isVisible = true;
    let profitHistory = [0];
    let isBetActive = false;
    let pendingHistoryPush = false;
    let settings = {
        opacity: 1,
        refreshRate: 50,
        allInWarning: true,
        chartDataViewer: false,
        notifications: {
            win: false,
            bet: false,
            loss: false
        }
    };
    let lastKnownBalance = null;
    let updateIntervalId = null;
    let wins = 0;
    let losses = 0;
    let wagered = 0;
    let hoveredPointIndex = null;

    function isContextValid() {
        const valid = !!chrome.runtime?.id;
        console.log('[FlipHelper Debug] isContextValid returning:', valid);
        return valid;
    }

    function getCurrentBalance() {
        const selectors = [
            '[class*="headerUserBalance"] [class*="text"]',
            '[class*="balance_amount"]',
            '.wallet-balance',
            '[class*="UserBalance"]',
            '[class*="BalanceDisplay"]',
            '#balance'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const text = el.innerText.trim().replace(/[^0-9.]/g, '');
                const val = parseFloat(text);
                if (!isNaN(val) && val > 0) {
                    return val;
                }
            }
        }
        return null;
    }

    function getActiveCurrencyFromDOM() {
        const el = document.querySelector('[class*="headerUserCurrencySelectorLabel"]');
        if (el) {
            const text = el.textContent.trim().toUpperCase();
            if (text.includes('FLIP')) {
                return 'FLIPCOINS';
            }
            if (text.includes('ROC') || text.includes('ROB') || text.includes('COIN')) {
                return 'ROCOINS';
            }
        }
        return null;
    }

    function extractActiveBalance(data) {
        if (!data) return { balance: null, currency: null };
        const wallet = data.wallet;
        if (wallet && wallet.balances) {
            const flipcoins = wallet.balances.FLIPCOINS || 0;
            const rocoins = wallet.balances.ROCOINS || wallet.balances.ROBUX || 0;
            const otherBal = wallet.balances.balance || wallet.balance || 0;

            const domCurrency = getActiveCurrencyFromDOM();
            if (domCurrency !== null) {
                const balance = domCurrency === 'FLIPCOINS' ? flipcoins : rocoins;
                if (activeCurrency !== null && domCurrency !== activeCurrency) {
                    console.log(`[FlipHelper State] Currency changed from ${activeCurrency} to ${domCurrency}. Resetting startingBalance.`);
                    startingBalance = balance;
                    if (isContextValid()) {
                        chrome.storage.local.set({ startingBalance: balance, activeCurrency: domCurrency });
                    }
                } else if (activeCurrency !== domCurrency) {
                    if (isContextValid()) {
                        chrome.storage.local.set({ activeCurrency: domCurrency });
                    }
                }
                activeCurrency = domCurrency;
                return { balance, currency: domCurrency };
            }

            if (activeCurrency === 'FLIPCOINS') {
                return { balance: flipcoins, currency: 'FLIPCOINS' };
            } else if (activeCurrency === 'ROCOINS') {
                return { balance: rocoins, currency: 'ROCOINS' };
            }

            return { balance: rocoins, currency: null };
        }
        if (wallet && typeof wallet.balance === 'number') {
            return { balance: wallet.balance, currency: null };
        }
        if (typeof data.balance === 'number') {
            return { balance: data.balance, currency: null };
        }
        if (wallet && wallet.balance === 0) return { balance: 0, currency: null };
        if (data.balance === 0) return { balance: 0, currency: null };
        return { balance: null, currency: null };
    }

    const REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
    const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    const MAIN_ICON = `<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_1_2)"><path d="M57.574 30.608V43.76H30.118V57.968H50.662V70.736H30.118V98H13.702V30.608H57.574Z" fill="#7ED957"/><path d="M115.711 30.608V98H99.2946V70.256H73.7586V98H57.3426V30.608H73.7586V57.008H99.2946V30.608H115.711Z" fill="#00BF63"/></g><defs><clipPath id="clip0_1_2"><rect width="128" height="128" fill="white"/></clipPath></defs></svg>`;
    const DISCORD_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107a14.314 14.314 0 0 0 1.226 1.994a.079.079 0 0 0 .084-.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.947 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z"/></svg>`;
    const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const BACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
    const BOMB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bomb-icon lucide-bomb"><circle cx="11" cy="13" r="9"/><path d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95"/><path d="m22 2-1.5 1.5"/></svg>`;
    const CHEVRON_DOWN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>`;
    const DICE_5_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-dice5-icon lucide-dice-5"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/></svg>`;
    const INFINITY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-infinity-icon lucide-infinity"><path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8"/></svg>`;
    const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play-icon lucide-play"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`;
    const SQUARE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`;
    const TOWER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chess-rook-icon lucide-chess-rook"><path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M10 2v2"/><path d="M14 2v2"/><path d="m17 18-1-9"/><path d="M6 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V2"/><path d="M6 4h12"/><path d="m7 18 1-9"/></svg>`;
    const TRIANGLE_ALERT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
    const COINS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins"><circle cx="8" cy="8" r="6"/><circle cx="18" cy="18" r="6"/><path d="M12 18a6 6 0 0 0-6-6"/></svg>`;
    const PERCENT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-percent"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
    const TRENDING_UP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
    const TRENDING_DOWN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-down"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`;
    const HASH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hash"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`;



    let root, container, notifContainer;
    let animationFrameId = null;

    let isAutobetting = false;
    let isAutobetGamesInfinite = false;
    let savedGamesLimitValue = "10";
    let autobetTimeoutId = null;
    let savedNotifications = null;

    function updatePageSupport() {
        const path = window.location.pathname.toLowerCase().replace(/\/$/, "");
        const isMinesPage = path === '/mines';
        const isTowersPage = path === '/towers';
        const isDicePage = path === '/dice';
        const isSupported = isMinesPage || isTowersPage || isDicePage;

        const isAutoTabActive = document.getElementById('fh-tab-btn-auto')?.classList.contains('active');
        const container = root.querySelector('.fh-container');

        if (isAutoTabActive && isSupported) {
            container.classList.add('fh-autobet-active');
        } else {
            container.classList.remove('fh-autobet-active');
        }

        const supportedView = document.getElementById('fh-autobet-supported-view');
        const unsupportedView = document.getElementById('fh-autobet-unsupported-view');

        if (isSupported) {
            if (supportedView) supportedView.style.display = 'block';
            if (unsupportedView) unsupportedView.style.display = 'none';

            let modeName = '';
            let modeIcon = '';
            if (isMinesPage) {
                modeName = 'Mines';
                modeIcon = BOMB_ICON;
                document.getElementById('fh-auto-mines-settings').style.display = 'block';
                document.getElementById('fh-auto-towers-settings').style.display = 'none';
                document.getElementById('fh-auto-dice-settings').style.display = 'none';
            } else if (isTowersPage) {
                modeName = 'Towers';
                modeIcon = TOWER_ICON;
                document.getElementById('fh-auto-mines-settings').style.display = 'none';
                document.getElementById('fh-auto-towers-settings').style.display = 'block';
                document.getElementById('fh-auto-dice-settings').style.display = 'none';
            } else if (isDicePage) {
                modeName = 'Dice';
                modeIcon = DICE_5_ICON;
                document.getElementById('fh-auto-mines-settings').style.display = 'none';
                document.getElementById('fh-auto-towers-settings').style.display = 'none';
                document.getElementById('fh-auto-dice-settings').style.display = 'block';
            }


        } else {
            if (supportedView) supportedView.style.display = 'none';
            if (unsupportedView) unsupportedView.style.display = 'flex';
        }

        adjustHeight();
    }

    function bindAutobetEvents() {
        const presetSelect = document.getElementById('fh-auto-preset');
        const winModeSelect = document.getElementById('fh-auto-on-win-mode');
        const lossModeSelect = document.getElementById('fh-auto-on-loss-mode');
        const winPctInput = document.getElementById('fh-auto-on-win-pct');
        const lossPctInput = document.getElementById('fh-auto-on-loss-pct');
        const winPctWrapper = document.getElementById('fh-win-pct-wrapper');
        const lossPctWrapper = document.getElementById('fh-loss-pct-wrapper');
        const gamesLimitInput = document.getElementById('fh-auto-games-limit');
        const infiniteBtn = document.getElementById('fh-auto-btn-infinite');
        const toggleBtn = document.getElementById('fh-btn-autobet-toggle');

        function updateOnWinDisplay() {
            if (winModeSelect.value === 'increase') {
                winPctWrapper.style.display = 'flex';
            } else {
                winPctWrapper.style.display = 'none';
            }
            syncCustomSelect('fh-custom-select-on-win-mode', 'fh-auto-on-win-mode');
            adjustHeight();
        }

        function updateOnLossDisplay() {
            if (lossModeSelect.value === 'increase') {
                lossPctWrapper.style.display = 'flex';
            } else {
                lossPctWrapper.style.display = 'none';
            }
            syncCustomSelect('fh-custom-select-on-loss-mode', 'fh-auto-on-loss-mode');
            adjustHeight();
        }

        presetSelect.onchange = () => {
            const val = presetSelect.value;
            if (val === 'martingale') {
                winModeSelect.value = 'reset';
                lossModeSelect.value = 'increase';
                lossPctInput.value = '100';
            } else if (val === 'reverse-martingale') {
                winModeSelect.value = 'increase';
                winPctInput.value = '100';
                lossModeSelect.value = 'reset';
            }
            syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
            updateOnWinDisplay();
            updateOnLossDisplay();
        };

        winModeSelect.onchange = () => {
            presetSelect.value = 'none';
            syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
            updateOnWinDisplay();
        };

        lossModeSelect.onchange = () => {
            presetSelect.value = 'none';
            syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
            updateOnLossDisplay();
        };

        winPctInput.oninput = () => {
            presetSelect.value = 'none';
            syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
        };

        lossPctInput.oninput = () => {
            presetSelect.value = 'none';
            syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
        };

        infiniteBtn.onclick = () => {
            isAutobetGamesInfinite = !isAutobetGamesInfinite;
            if (isAutobetGamesInfinite) {
                savedGamesLimitValue = gamesLimitInput.value;
                gamesLimitInput.value = '∞';
                gamesLimitInput.readOnly = true;
                infiniteBtn.classList.add('active');
            } else {
                gamesLimitInput.value = savedGamesLimitValue;
                gamesLimitInput.readOnly = false;
                infiniteBtn.classList.remove('active');
            }
        };

        let confirmTimeoutId = null;
        toggleBtn.onclick = () => {
            if (isAutobetting) {
                stopAutobet();
            } else {
                const startBetVal = parseFloat(document.getElementById('fh-auto-start-bet').value);
                const stopLoss = parseFloat(document.getElementById('fh-auto-stop-loss').value);
                const takeProfit = parseFloat(document.getElementById('fh-auto-take-profit').value);
                const currentBal = currentBalance !== null ? currentBalance : startingBalance;
                const isExtreme = (startBetVal > (currentBal || 0) * 0.25) || ((isNaN(stopLoss) || stopLoss <= 0) && (isNaN(takeProfit) || takeProfit <= 0));
                if (isExtreme && !toggleBtn.classList.contains('confirming')) {
                    toggleBtn.classList.add('confirming');
                    toggleBtn.innerHTML = `${TRIANGLE_ALERT_ICON}<span>Confirm Start?</span>`;
                    if (confirmTimeoutId) clearTimeout(confirmTimeoutId);
                    confirmTimeoutId = setTimeout(() => {
                        toggleBtn.classList.remove('confirming');
                        toggleBtn.innerHTML = `${PLAY_ICON}<span>Start Autobet</span>`;
                    }, 3000);
                    return;
                }
                if (confirmTimeoutId) {
                    clearTimeout(confirmTimeoutId);
                    confirmTimeoutId = null;
                }
                toggleBtn.classList.remove('confirming');
                startAutobet();
            }
        };

        function setupCustomSelect(customId, nativeId) {
            const custom = document.getElementById(customId);
            const native = document.getElementById(nativeId);
            if (!custom || !native) return;
            const trigger = custom.querySelector('.fh-select-trigger');
            const options = custom.querySelectorAll('.fh-select-option');
            trigger.onclick = (e) => {
                e.stopPropagation();
                const open = custom.classList.contains('open');
                document.querySelectorAll('.fh-custom-select').forEach(el => el.classList.remove('open'));
                if (!open) {
                    custom.classList.add('open');
                }
                adjustHeight();
            };
            options.forEach(opt => {
                opt.onclick = (e) => {
                    e.stopPropagation();
                    const val = opt.getAttribute('data-value');
                    native.value = val;
                    native.dispatchEvent(new Event('change'));
                    custom.classList.remove('open');
                    adjustHeight();
                };
            });
        }

        setupCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
        setupCustomSelect('fh-custom-select-on-win-mode', 'fh-auto-on-win-mode');
        setupCustomSelect('fh-custom-select-on-loss-mode', 'fh-auto-on-loss-mode');
        setupCustomSelect('fh-custom-select-towers-difficulty', 'fh-auto-towers-difficulty');
        setupCustomSelect('fh-custom-select-dice-rolltype', 'fh-auto-dice-rolltype');

        window.addEventListener('click', () => {
            document.querySelectorAll('.fh-custom-select').forEach(el => el.classList.remove('open'));
        });

        function setupLimitControl(pillId, wrapperId, inputId, clearId) {
            const pill = document.getElementById(pillId);
            const wrapper = document.getElementById(wrapperId);
            const input = document.getElementById(inputId);
            const clear = document.getElementById(clearId);
            if (!pill || !wrapper || !input || !clear) return;

            function checkState() {
                const val = parseFloat(input.value);
                if (isNaN(val) || val <= 0) {
                    pill.style.display = 'flex';
                    wrapper.classList.remove('active');
                } else {
                    pill.style.display = 'none';
                    wrapper.classList.add('active');
                }
                adjustHeight();
            }

            pill.onclick = () => {
                pill.style.display = 'none';
                wrapper.classList.add('active');
                input.value = '10.00';
                input.focus();
                adjustHeight();
            };

            clear.onclick = () => {
                input.value = '0.00';
                pill.style.display = 'flex';
                wrapper.classList.remove('active');
                adjustHeight();
            };

            input.onblur = () => {
                checkState();
            };

            checkState();
        }

        setupLimitControl('fh-btn-toggle-stop-loss', 'fh-stop-loss-input-wrapper', 'fh-auto-stop-loss', 'fh-btn-clear-stop-loss');
        setupLimitControl('fh-btn-toggle-take-profit', 'fh-take-profit-input-wrapper', 'fh-auto-take-profit', 'fh-btn-clear-take-profit');

        syncCustomSelect('fh-custom-select-preset', 'fh-auto-preset');
        syncCustomSelect('fh-custom-select-on-win-mode', 'fh-auto-on-win-mode');
        syncCustomSelect('fh-custom-select-on-loss-mode', 'fh-auto-on-loss-mode');
        syncCustomSelect('fh-custom-select-towers-difficulty', 'fh-auto-towers-difficulty');
        syncCustomSelect('fh-custom-select-dice-rolltype', 'fh-auto-dice-rolltype');
    }

    function syncCustomSelect(customId, nativeId) {
        const custom = document.getElementById(customId);
        const native = document.getElementById(nativeId);
        if (!custom || !native) return;
        const val = native.value;
        const triggerVal = custom.querySelector('.fh-select-selected-value');
        const options = custom.querySelectorAll('.fh-select-option');
        options.forEach(opt => {
            if (opt.getAttribute('data-value') === val) {
                opt.classList.add('selected');
                if (triggerVal) triggerVal.textContent = opt.textContent;
            } else {
                opt.classList.remove('selected');
            }
        });
    }

    async function startAutobet() {
        const startBetVal = parseFloat(document.getElementById('fh-auto-start-bet').value);
        if (isNaN(startBetVal) || startBetVal < 0.10) {
            showNotification('Starting bet must be at least 0.10', 'loss');
            return;
        }

        const path = window.location.pathname.toLowerCase().replace(/\/$/, "");
        const isMinesPage = path === '/mines';
        const isTowersPage = path === '/towers';
        const isDicePage = path === '/dice';

        let minesCount, minesTiles, towersDiff, towersPath, diceMulti, diceRollType;

        if (isMinesPage) {
            minesCount = parseInt(document.getElementById('fh-auto-mines-count').value);
            if (isNaN(minesCount) || minesCount < 1 || minesCount > 24) {
                showNotification('Mines count must be between 1 and 24', 'loss');
                return;
            }
            const tilesVal = document.getElementById('fh-auto-mines-tiles').value.split(',');
            minesTiles = tilesVal.map(t => parseInt(t.trim())).filter(t => !isNaN(t) && t >= 0 && t <= 24);
            if (minesTiles.length === 0) {
                showNotification('Provide at least one valid autoplay tile (0-24)', 'loss');
                return;
            }
        } else if (isTowersPage) {
            towersDiff = document.getElementById('fh-auto-towers-difficulty').value;
            const pathVal = document.getElementById('fh-auto-towers-path').value.split(',');
            towersPath = pathVal.map(t => parseInt(t.trim())).filter(t => !isNaN(t) && t >= 0 && t <= 2);
            if (towersPath.length === 0) {
                showNotification('Provide at least one autoplay path step (0-2)', 'loss');
                return;
            }
        } else if (isDicePage) {
            diceMulti = parseFloat(document.getElementById('fh-auto-dice-multiplier').value);
            if (isNaN(diceMulti) || diceMulti < 1.01 || diceMulti > 100) {
                showNotification('Dice multiplier must be between 1.01 and 100', 'loss');
                return;
            }
            diceRollType = document.getElementById('fh-auto-dice-rolltype').value;
        }

        let gamesLimit = -1;
        if (!isAutobetGamesInfinite) {
            gamesLimit = parseInt(document.getElementById('fh-auto-games-limit').value);
            if (isNaN(gamesLimit) || gamesLimit <= 0) {
                showNotification('Games limit must be a positive integer or infinite', 'loss');
                return;
            }
        }

        const stopLoss = parseFloat(document.getElementById('fh-auto-stop-loss').value);
        const takeProfit = parseFloat(document.getElementById('fh-auto-take-profit').value);

        const winMode = document.getElementById('fh-auto-on-win-mode').value;
        const winPct = parseFloat(document.getElementById('fh-auto-on-win-pct').value);
        const lossMode = document.getElementById('fh-auto-on-loss-mode').value;
        const lossPct = parseFloat(document.getElementById('fh-auto-on-loss-pct').value);

        isAutobetting = true;

        savedNotifications = {
            win: settings.notifications.win,
            bet: settings.notifications.bet,
            loss: settings.notifications.loss
        };
        settings.notifications.win = false;
        settings.notifications.bet = false;
        settings.notifications.loss = false;

        const toggleBtn = document.getElementById('fh-btn-autobet-toggle');
        toggleBtn.classList.add('running');
        toggleBtn.innerHTML = `${SQUARE_ICON}<span>Stop Autobet</span>`;

        document.getElementById('fh-autobet-config-view').style.display = 'none';
        document.getElementById('fh-autobet-running-view').style.display = 'block';

        const logList = document.getElementById('fh-autobet-log-list');
        if (logList) logList.innerHTML = '';

        const pnlEl = document.getElementById('fh-run-stat-pnl');
        if (pnlEl) {
            pnlEl.textContent = '0.00';
            pnlEl.className = 'fh-run-stat-val';
        }
        const gamesEl = document.getElementById('fh-run-stat-games');
        if (gamesEl) {
            gamesEl.textContent = isAutobetGamesInfinite ? '0' : gamesLimit;
            const gamesLabelEl = gamesEl.previousElementSibling;
            if (gamesLabelEl) {
                gamesLabelEl.textContent = isAutobetGamesInfinite ? 'Games Played' : 'Games Remaining';
            }
        }

        adjustHeight();
        disableAutobetInputs(true);

        let currentBet = startBetVal;
        let gamesPlayed = 0;
        let startBalance = currentBalance !== null ? currentBalance : startingBalance;
        if (startBalance === null) {
            try {
                const response = await fetch('/api/user');
                if (response.ok) {
                    const data = await response.json();
                    const res = extractActiveBalance(data);
                    const raw = res.balance;
                    if (raw !== null) {
                        startBalance = Math.round(raw * 100) / 100;
                        updateProfitFromBalance(raw);
                    }
                }
            } catch (e) { }
        }
        if (startBalance === null) {
            startBalance = 0;
        }

        (async function loop() {
            if (!isAutobetting) return;

            const currentBal = currentBalance !== null ? currentBalance : startBalance;
            const currentSessionProfit = currentBal - startBalance;

            if (stopLoss > 0 && currentSessionProfit <= -stopLoss) {
                showNotification('Stop loss reached', 'info');
                stopAutobet();
                return;
            }

            if (takeProfit > 0 && currentSessionProfit >= takeProfit) {
                showNotification('Take profit reached', 'info');
                stopAutobet();
                return;
            }

            if (gamesLimit > 0 && gamesPlayed >= gamesLimit) {
                showNotification('Games limit reached', 'info');
                stopAutobet();
                return;
            }

            if (currentBal > 0 && currentBet > currentBal) {
                showNotification('Insufficient balance', 'loss');
                stopAutobet();
                return;
            }

            let requestUrl = '';
            let requestBody = {};

            if (isMinesPage) {
                requestUrl = '/api/games/mines/create';
                requestBody = {
                    mines: String(minesCount),
                    betAmount: currentBet,
                    grid: 5,
                    autoPlay: minesTiles
                };
            } else if (isTowersPage) {
                requestUrl = '/api/games/towers/create';
                requestBody = {
                    difficulty: towersDiff,
                    betAmount: currentBet,
                    autoPlay: towersPath
                };
            } else if (isDicePage) {
                requestUrl = '/api/games/dice/roll';
                const pct = 93 / diceMulti;
                let minVal, maxVal;
                if (diceRollType === 'over') {
                    minVal = 100 - pct;
                    maxVal = 99.99;
                } else {
                    minVal = 0;
                    maxVal = pct;
                }
                requestBody = {
                    bet: currentBet,
                    ranges: [{ min: parseFloat(minVal.toFixed(2)), max: parseFloat(maxVal.toFixed(2)) }],
                    multiplier: diceMulti,
                    payout: parseFloat((currentBet * diceMulti).toFixed(2))
                };
            }

            let responseOk = false;
            let responseData = null;

            try {
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-currency': 'FLIPCOINS'
                    },
                    body: JSON.stringify(requestBody)
                });
                if (response.ok) {
                    responseData = await response.json();
                    responseOk = responseData && (responseData.success !== false);
                }
            } catch (e) {
                console.error(e);
            }

            if (!responseOk || !responseData) {
                showNotification('Bet request failed', 'loss');
                stopAutobet();
                return;
            }

            let isWin = false;
            let newBalance = currentBal;
            let profitDiff = 0;

            if (isMinesPage) {
                isWin = !responseData.exploded;
                const winnings = responseData.winnings || 0;
                profitDiff = isWin ? (winnings - currentBet) : -currentBet;
                newBalance = currentBal + profitDiff;
            } else if (isTowersPage) {
                isWin = !responseData.game.exploded;
                const payout = responseData.game.payout || 0;
                profitDiff = isWin ? (payout - currentBet) : -currentBet;
                newBalance = currentBal + profitDiff;
            } else if (isDicePage) {
                isWin = responseData.isWin === true || responseData.win === true || (responseData.payout && responseData.payout > 0);
                const payout = isWin ? (currentBet * diceMulti) : 0;
                profitDiff = isWin ? (payout - currentBet) : -currentBet;
                newBalance = currentBal + profitDiff;
            }

            updateProfitFromBalance(newBalance);
            gamesPlayed++;

            const sessionProfit = newBalance - startBalance;
            const pnlEl = document.getElementById('fh-run-stat-pnl');
            if (pnlEl) {
                pnlEl.textContent = (sessionProfit >= 0 ? '+' : '') + sessionProfit.toFixed(2);
                pnlEl.className = 'fh-run-stat-val ' + (sessionProfit >= 0 ? 'positive' : 'negative');
            }
            const gamesEl = document.getElementById('fh-run-stat-games');
            if (gamesEl) {
                gamesEl.textContent = isAutobetGamesInfinite ? gamesPlayed : Math.max(0, gamesLimit - gamesPlayed);
            }

            const logList = document.getElementById('fh-autobet-log-list');
            if (logList) {
                const item = document.createElement('div');
                item.className = 'fh-run-log-item';
                const formattedDiff = (profitDiff >= 0 ? '+' : '') + profitDiff.toFixed(2);
                const outcomeClass = isWin ? 'win' : 'loss';
                const outcomeText = isWin ? 'Win' : 'Loss';
                item.innerHTML = `
                    <span>Bet: ${currentBet.toFixed(2)}</span>
                    <span class="fh-run-log-outcome ${outcomeClass}">${outcomeText} (${formattedDiff})</span>
                `;
                logList.insertBefore(item, logList.firstChild);
                while (logList.children.length > 30) {
                    logList.removeChild(logList.lastChild);
                }
                adjustHeight();
            }

            if (isWin) {
                if (winMode === 'reset') {
                    currentBet = startBetVal;
                } else {
                    currentBet = currentBet * (1 + winPct / 100);
                }
            } else {
                if (lossMode === 'reset') {
                    currentBet = startBetVal;
                } else {
                    currentBet = currentBet * (1 + lossPct / 100);
                }
            }

            autobetTimeoutId = setTimeout(loop, 1000);
        })();
    }

    function stopAutobet() {
        isAutobetting = false;
        if (autobetTimeoutId) {
            clearTimeout(autobetTimeoutId);
            autobetTimeoutId = null;
        }

        if (savedNotifications) {
            settings.notifications.win = savedNotifications.win;
            settings.notifications.bet = savedNotifications.bet;
            settings.notifications.loss = savedNotifications.loss;
            savedNotifications = null;
        }

        const toggleBtn = document.getElementById('fh-btn-autobet-toggle');
        if (toggleBtn) {
            toggleBtn.classList.remove('running');
            toggleBtn.classList.remove('confirming');
            toggleBtn.innerHTML = `${PLAY_ICON}<span>Start Autobet</span>`;
        }

        const configView = document.getElementById('fh-autobet-config-view');
        const runningView = document.getElementById('fh-autobet-running-view');
        if (configView) configView.style.display = 'block';
        if (runningView) runningView.style.display = 'none';

        adjustHeight();
        disableAutobetInputs(false);
    }

    function disableAutobetInputs(disable) {
        const ids = [
            'fh-auto-start-bet',
            'fh-auto-preset',
            'fh-auto-on-win-mode',
            'fh-auto-on-win-pct',
            'fh-auto-on-loss-mode',
            'fh-auto-on-loss-pct',
            'fh-auto-stop-loss',
            'fh-auto-take-profit',
            'fh-auto-mines-count',
            'fh-auto-mines-tiles',
            'fh-auto-towers-difficulty',
            'fh-auto-towers-path',
            'fh-auto-dice-multiplier',
            'fh-auto-dice-rolltype',
            'fh-btn-toggle-stop-loss',
            'fh-btn-toggle-take-profit',
            'fh-btn-clear-stop-loss',
            'fh-btn-clear-take-profit'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = disable;
        });

        document.querySelectorAll('.fh-custom-select').forEach(el => {
            if (disable) {
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.6';
            } else {
                el.style.pointerEvents = 'auto';
                el.style.opacity = '1';
            }
        });

        const gamesInput = document.getElementById('fh-auto-games-limit');
        if (gamesInput) {
            gamesInput.disabled = disable || isAutobetGamesInfinite;
        }

        const infiniteBtn = document.getElementById('fh-auto-btn-infinite');
        if (infiniteBtn) {
            infiniteBtn.disabled = disable;
        }
    }

    function adjustHeight() {
        const container = root.querySelector('.fh-container');
        if (!container) return;
        const slider = document.getElementById('fh-slider');
        const isSettings = slider && slider.style.transform === 'translateX(-50%)';

        const tracker = document.getElementById('fh-tab-tracker');
        const auto = document.getElementById('fh-tab-auto');
        const predictor = document.getElementById('fh-tab-predictor');
        if (tracker && auto && predictor) {
            const origDisplay = tracker.style.display;
            tracker.style.display = 'block';
            const h = tracker.offsetHeight;
            tracker.style.display = origDisplay;

            auto.style.minHeight = h + 'px';
            predictor.style.minHeight = h + 'px';
        }

        const activeView = isSettings ? document.getElementById('fh-settings-view') : document.getElementById('fh-main-view');
        if (activeView) {
            container.style.height = activeView.offsetHeight + 'px';
        }
    }

    function startAnimationLoop() {
        if (animationFrameId) return;
        function loop() {
            const isTrackerActive = document.getElementById('fh-tab-tracker')?.classList.contains('active');
            if (isVisible && settings.chartDataViewer && isTrackerActive) {
                renderChart();
                animationFrameId = requestAnimationFrame(loop);
            } else {
                animationFrameId = null;
            }
        }
        loop();
    }

    function switchTab(tabName) {
        const tabs = ['tracker', 'auto', 'predictor'];
        tabs.forEach(name => {
            const btn = document.getElementById(`fh-tab-btn-${name}`);
            const pane = document.getElementById(`fh-tab-${name}`);
            if (name === tabName) {
                btn?.classList.add('active');
                pane?.classList.add('active');
                if (pane) pane.style.display = 'block';
            } else {
                btn?.classList.remove('active');
                pane?.classList.remove('active');
                if (pane) pane.style.display = 'none';
            }
        });

        if (tabName === 'tracker' && settings.chartDataViewer) {
            startAnimationLoop();
        }

        if (tabName === 'auto') {
            updatePageSupport();
        } else {
            const container = root.querySelector('.fh-container');
            if (container) {
                container.classList.remove('fh-autobet-active');
            }
        }

        adjustHeight();
    }

    function injectFonts() {
        console.log('[FlipHelper Debug] injectFonts called');
        if (document.getElementById('fh-fonts')) {
            console.log('[FlipHelper Debug] Fonts already injected, skipping');
            return;
        }
        const fontFace = `
            @font-face {
                font-family: 'Inter';
                src: url('${chrome.runtime.getURL('fonts/inter-400.woff2')}') format('woff2');
                font-weight: 400;
                font-style: normal;
            }
            @font-face {
                font-family: 'Inter';
                src: url('${chrome.runtime.getURL('fonts/inter-600.woff2')}') format('woff2');
                font-weight: 600;
                font-style: normal;
            }
            @font-face {
                font-family: 'Inter';
                src: url('${chrome.runtime.getURL('fonts/inter-700.woff2')}') format('woff2');
                font-weight: 700;
                font-style: normal;
            }
            @font-face {
                font-family: 'Inter';
                src: url('${chrome.runtime.getURL('fonts/inter-800.woff2')}') format('woff2');
                font-weight: 800;
                font-style: normal;
            }
            @font-face {
                font-family: 'Inter';
                src: url('${chrome.runtime.getURL('fonts/inter-900.woff2')}') format('woff2');
                font-weight: 900;
                font-style: normal;
            }
        `;
        const style = document.createElement('style');
        style.id = 'fh-fonts';
        style.textContent = fontFace;
        document.head.appendChild(style);
        console.log('[FlipHelper Debug] injectFonts completed');
    }

    function injectUI() {
        console.log('[FlipHelper Debug] injectUI called');
        if (document.getElementById('fliphelper-root')) {
            console.log('[FlipHelper Debug] fliphelper-root already exists, skipping UI injection');
            return;
        }

        injectFonts();

        root = document.createElement('div');
        root.id = 'fliphelper-root';
        root.className = isVisible ? 'visible' : '';

        root.innerHTML = `
            <div class="fh-container ${settings.chartDataViewer ? 'fh-chart-active' : ''}">
                <div class="fh-view-slider" id="fh-slider">
                    <div id="fh-main-view" class="fh-view">
                        <div class="fh-header fh-drag-handle">
                            <div class="fh-logo-container">
                                <div class="fh-main-icon">${MAIN_ICON}</div>
                                <div class="fh-title-group">
                                    <div class="fh-logo">Flip<span>Helper</span></div>
                                </div>
                            </div>
                            <div class="fh-controls">
                                <button class="fh-btn" id="fh-discord-btn" title="Join Discord">${DISCORD_ICON}</button>
                                <button class="fh-btn" id="fh-refresh-btn" title="Reset Session">${REFRESH_ICON}</button>
                                <button class="fh-btn" id="fh-settings-btn" title="Settings">${SETTINGS_ICON}</button>
                                <button class="fh-btn" id="fh-close-btn" title="Close">${CLOSE_ICON}</button>
                            </div>
                        </div>
                        <div class="fh-body">
                            <div id="fh-tab-tracker" class="fh-tab-content active">
                                <div class="fh-profit-section">
                                    <div class="fh-stat-label">Session Profit</div>
                                    <div class="fh-profit-display-main fh-profit-val">
                                        <span id="fh-profit-value">0.00</span>
                                    </div>
                                </div>
                                <div class="fh-stats-row">
                                    <div class="fh-stat-item-flat">
                                        <span class="fh-stat-label-inline">Wins:</span>
                                        <span class="fh-wins-val-inline" id="fh-wins-value">0</span>
                                    </div>
                                    <div class="fh-stat-item-flat">
                                        <span class="fh-stat-label-inline">Losses:</span>
                                        <span class="fh-losses-val-inline" id="fh-losses-value">0</span>
                                    </div>
                                    <div class="fh-stat-item-flat">
                                        <span class="fh-stat-label-inline">Wagered:</span>
                                        <span class="fh-wagered-val-inline" id="fh-wagered-value">0.00</span>
                                    </div>
                                </div>
                                <div class="fh-chart-container" id="fh-chart-container">
                                    <canvas id="fh-profit-chart"></canvas>
                                </div>
                            </div>
                            <div id="fh-tab-auto" class="fh-tab-content" style="display: none; padding: 12px 14px; box-sizing: border-box; width: 100%;">
                                <div id="fh-autobet-unsupported-view" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; text-align: center; width: 100%; min-height: 160px;">
                                    <div style="color: #FF4B4B; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">${TRIANGLE_ALERT_ICON}</div>
                                    <div class="fh-placeholder-title" style="margin: 0;">Unsupported Game Mode</div>
                                    <div class="fh-placeholder-desc" style="margin: 0; padding: 0 8px;">Please navigate to Mines, Towers, or Dice to use Autobet.</div>
                                </div>
                                <div id="fh-autobet-supported-view" style="display: none; width: 100%;">
                                    <div id="fh-autobet-config-view" class="fh-space-y-3">
                                        <div class="fh-autobet-group">
                                            <h2>Bet Settings</h2>
                                            <div class="fh-autobet-grid">
                                                <div class="fh-autobet-field" style="grid-column: span 2;">
                                                    <label for="fh-auto-start-bet">Starting Bet</label>
                                                    <div class="fh-field-input-wrapper">
                                                        <div class="fh-field-icon">${COINS_ICON}</div>
                                                        <input type="number" id="fh-auto-start-bet" value="1.00" step="0.1" min="0.1">
                                                    </div>
                                                </div>
                                                <div class="fh-autobet-field" style="grid-column: span 2;">
                                                    <label for="fh-auto-preset">Strategies</label>
                                                    <div class="fh-custom-select" id="fh-custom-select-preset">
                                                        <div class="fh-select-trigger">
                                                            <span class="fh-select-selected-value">None</span>
                                                            <div class="fh-select-chevron">${CHEVRON_DOWN_ICON}</div>
                                                        </div>
                                                        <div class="fh-select-options">
                                                            <div class="fh-select-option selected" data-value="none">None</div>
                                                            <div class="fh-select-option" data-value="martingale">Martingale</div>
                                                            <div class="fh-select-option" data-value="reverse-martingale">Reverse Martingale</div>
                                                        </div>
                                                    </div>
                                                    <select id="fh-auto-preset" style="display: none;">
                                                        <option value="none" selected>None</option>
                                                        <option value="martingale">Martingale</option>
                                                        <option value="reverse-martingale">Reverse Martingale</option>
                                                    </select>
                                                </div>
                                                <div class="fh-autobet-field">
                                                    <label>On Win</label>                                                     <div style="display: flex; gap: 4px; width: 100%; align-items: center;">
                                                         <div class="fh-custom-select" id="fh-custom-select-on-win-mode" style="flex: 1;">
                                                             <div class="fh-select-trigger">
                                                                 <span class="fh-select-selected-value">Reset</span>
                                                                 <div class="fh-select-chevron">${CHEVRON_DOWN_ICON}</div>
                                                             </div>
                                                             <div class="fh-select-options">
                                                                 <div class="fh-select-option selected" data-value="reset">Reset</div>
                                                                 <div class="fh-select-option" data-value="increase">Increase</div>
                                                             </div>
                                                         </div>
                                                         <select id="fh-auto-on-win-mode" style="display: none;">
                                                             <option value="reset" selected>Reset</option>
                                                             <option value="increase">Increase</option>
                                                         </select>
                                                          <div class="fh-field-input-wrapper" id="fh-win-pct-wrapper" style="display: none; flex: 0 0 68px;">
                                                             <div class="fh-field-icon">${PERCENT_ICON}</div>
                                                             <input type="number" id="fh-auto-on-win-pct" value="100" min="0">
                                                         </div>
                                                     </div>
                                                 </div>
                                                 <div class="fh-autobet-field">
                                                     <label>On Loss</label>
                                                     <div style="display: flex; gap: 4px; width: 100%; align-items: center;">
                                                         <div class="fh-custom-select" id="fh-custom-select-on-loss-mode" style="flex: 1;">
                                                             <div class="fh-select-trigger">
                                                                 <span class="fh-select-selected-value">Reset</span>
                                                                 <div class="fh-select-chevron">${CHEVRON_DOWN_ICON}</div>
                                                             </div>
                                                             <div class="fh-select-options">
                                                                 <div class="fh-select-option selected" data-value="reset">Reset</div>
                                                                 <div class="fh-select-option" data-value="increase">Increase</div>
                                                             </div>
                                                         </div>
                                                         <select id="fh-auto-on-loss-mode" style="display: none;">
                                                              <option value="reset" selected>Reset</option>
                                                              <option value="increase">Increase</option>
                                                          </select>
                                                           <div class="fh-field-input-wrapper" id="fh-loss-pct-wrapper" style="display: none; flex: 0 0 68px;">
                                                              <div class="fh-field-icon">${PERCENT_ICON}</div>
                                                              <input type="number" id="fh-auto-on-loss-pct" value="100" min="0">
                                                          </div>
                                                      </div>
                                                  </div>
                                              </div>
                                          </div>
                                        
                                        <div class="fh-autobet-group">
                                            <h2>Session Limits</h2>
                                            <div class="fh-autobet-grid">
                                                <div class="fh-autobet-field">
                                                    <label for="fh-auto-games-limit">Number of Games</label>
                                                    <div class="fh-field-input-wrapper">
                                                        <div class="fh-field-icon">${HASH_ICON}</div>
                                                        <input type="text" id="fh-auto-games-limit" value="10" style="width: 100%; padding-right: 32px; box-sizing: border-box;">
                                                        <button id="fh-auto-btn-infinite" style="position: absolute; right: 4px; background: none; border: none; padding: 4px; cursor: pointer; color: #888888; display: flex; align-items: center; justify-content: center; transition: color 0.2s; width: 22px; height: 22px;">
                                                            ${INFINITY_ICON}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div class="fh-autobet-field">
                                                    <label for="fh-auto-stop-loss">Stop Loss</label>
                                                    <div class="fh-limit-pill-container" id="fh-stop-loss-pill-container">
                                                        <button class="fh-limit-pill" id="fh-btn-toggle-stop-loss">No limit</button>
                                                        <div class="fh-limit-input-wrapper" id="fh-stop-loss-input-wrapper">
                                                            <div class="fh-field-input-wrapper">
                                                                <div class="fh-field-icon">${TRENDING_DOWN_ICON}</div>
                                                                <input type="number" id="fh-auto-stop-loss" value="0.00" step="1" min="0">
                                                            </div>
                                                            <button class="fh-limit-clear-btn" id="fh-btn-clear-stop-loss">${CLOSE_ICON}</button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div class="fh-autobet-field" style="grid-column: span 2;">
                                                    <label for="fh-auto-take-profit">Take Profit</label>
                                                    <div class="fh-limit-pill-container" id="fh-take-profit-pill-container">
                                                        <button class="fh-limit-pill" id="fh-btn-toggle-take-profit">No limit</button>
                                                        <div class="fh-limit-input-wrapper" id="fh-take-profit-input-wrapper">
                                                            <div class="fh-field-input-wrapper">
                                                                <div class="fh-field-icon">${TRENDING_UP_ICON}</div>
                                                                <input type="number" id="fh-auto-take-profit" value="0.00" step="1" min="0">
                                                            </div>
                                                            <button class="fh-limit-clear-btn" id="fh-btn-clear-take-profit">${CLOSE_ICON}</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                         <div id="fh-auto-game-settings-container" class="fh-autobet-group">
                                            <h2>Game Settings</h2>
                                            <div id="fh-auto-mines-settings" style="display: none; width: 100%;">
                                                <div class="fh-autobet-grid">
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-mines-count">Mines</label>
                                                        <input type="number" id="fh-auto-mines-count" value="3" min="1" max="24">
                                                    </div>
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-mines-tiles">Autoplay Tiles</label>
                                                         <input type="text" id="fh-auto-mines-tiles" value="12" placeholder="0-24 indices">
                                                    </div>
                                                </div>
                                            </div>
                                            <div id="fh-auto-towers-settings" style="display: none; width: 100%;">
                                                <div class="fh-autobet-grid">
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-towers-difficulty">Difficulty</label>
                                                        <div class="fh-custom-select" id="fh-custom-select-towers-difficulty">
                                                            <div class="fh-select-trigger">
                                                                <span class="fh-select-selected-value">Easy</span>
                                                                <div class="fh-select-chevron">${CHEVRON_DOWN_ICON}</div>
                                                            </div>
                                                            <div class="fh-select-options">
                                                                <div class="fh-select-option selected" data-value="easy">Easy</div>
                                                                <div class="fh-select-option" data-value="normal">Normal</div>
                                                                <div class="fh-select-option" data-value="hard">Hard</div>
                                                            </div>
                                                        </div>
                                                        <select id="fh-auto-towers-difficulty" style="display: none;">
                                                            <option value="easy" selected>Easy</option>
                                                            <option value="normal">Normal</option>
                                                            <option value="hard">Hard</option>
                                                        </select>
                                                    </div>
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-towers-path">Autoplay Path</label>
                                                        <input type="text" id="fh-auto-towers-path" value="0" placeholder="0-2 indices">
                                                    </div>
                                                </div>
                                            </div>
                                            <div id="fh-auto-dice-settings" style="display: none; width: 100%;">
                                                <div class="fh-autobet-grid">
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-dice-multiplier">Multiplier</label>
                                                        <input type="number" id="fh-auto-dice-multiplier" value="2.00" step="0.1" min="1.01" max="100">
                                                    </div>
                                                    <div class="fh-autobet-field">
                                                        <label for="fh-auto-dice-rolltype">Roll Type</label>
                                                        <div class="fh-custom-select" id="fh-custom-select-dice-rolltype">
                                                            <div class="fh-select-trigger">
                                                                <span class="fh-select-selected-value">Roll Over</span>
                                                                <div class="fh-select-chevron">${CHEVRON_DOWN_ICON}</div>
                                                            </div>
                                                            <div class="fh-select-options">
                                                                <div class="fh-select-option selected" data-value="over">Roll Over</div>
                                                                <div class="fh-select-option" data-value="under">Roll Under</div>
                                                            </div>
                                                        </div>
                                                        <select id="fh-auto-dice-rolltype" style="display: none;">
                                                            <option value="over" selected>Roll Over</option>
                                                            <option value="under">Roll Under</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div id="fh-autobet-running-view">
                                        <div class="fh-run-stats-grid">
                                            <div class="fh-run-stat-card">
                                                <label>Session PnL</label>
                                                <div class="fh-run-stat-val" id="fh-run-stat-pnl">0.00</div>
                                            </div>
                                            <div class="fh-run-stat-card">
                                                <label>Games Remaining</label>
                                                <div class="fh-run-stat-val" id="fh-run-stat-games">0</div>
                                            </div>
                                        </div>
                                        <div class="fh-run-log-card">
                                            <h2>Session Log</h2>
                                            <div class="fh-run-log-list" id="fh-autobet-log-list">
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <button class="fh-btn-primary" id="fh-btn-autobet-toggle" style="width: 100%; margin-top: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box;">
                                        ${PLAY_ICON}<span>Start Autobet</span>
                                    </button>
                                </div>
                            </div>
                            <div id="fh-tab-predictor" class="fh-tab-content" style="display: none;">
                                <div class="fh-placeholder-title">Blox-Predictor</div>
                                <div class="fh-placeholder-desc">Try out Blox-Predictor for free now!</div>
                                <button class="fh-btn-primary" id="fh-predictor-redirect-btn">Get Started</button>
                            </div>
                        </div>
                        <div class="fh-tab-bar">
                            <button class="fh-tab active" id="fh-tab-btn-tracker">Tracker</button>
                            <button class="fh-tab" id="fh-tab-btn-auto">Auto</button>
                            <button class="fh-tab" id="fh-tab-btn-predictor">Predictor</button>
                        </div>
                    </div>

                    <div id="fh-settings-view" class="fh-view">
                        <div class="fh-header fh-drag-handle">
                            <div class="fh-logo-container">
                                <button class="fh-btn" id="fh-back-btn" style="margin-left: -6px; margin-right: 8px;">${BACK_ICON}</button>
                                <div class="fh-logo">Settings</div>
                            </div>
                        </div>
                        <div class="fh-settings-body">
                            <div class="fh-cards-row">
                                <div id="fh-card-basic" class="fh-card ${!settings.chartDataViewer ? 'active' : ''}">
                                    <div class="fh-card-icon" style="-webkit-mask-image: url('${chrome.runtime.getURL('basic.svg')}'); mask-image: url('${chrome.runtime.getURL('basic.svg')}');"></div>
                                    <div class="fh-card-label">Basic</div>
                                </div>
                                <div id="fh-card-chart" class="fh-card ${settings.chartDataViewer ? 'active' : ''}">
                                    <div class="fh-card-icon" style="-webkit-mask-image: url('${chrome.runtime.getURL('chart.svg')}'); mask-image: url('${chrome.runtime.getURL('chart.svg')}');"></div>
                                    <div class="fh-card-label">Chart</div>
                                </div>
                            </div>
                            <div class="fh-setting-item">
                                <div class="fh-setting-header">
                                    <label>Opacity</label>
                                    <span class="fh-setting-value" id="fh-opacity-val">${Math.round(settings.opacity * 100)}%</span>
                                </div>
                                <input type="range" id="fh-opacity-range" min="0.2" max="1" step="0.1" value="${settings.opacity}">
                            </div>
                            <div class="fh-setting-item">
                                <div class="fh-setting-header">
                                    <label>Refresh Rate</label>
                                    <span class="fh-setting-value" id="fh-refresh-val">${settings.refreshRate} ms</span>
                                </div>
                                <input type="range" id="fh-refresh-range" min="50" max="2000" step="50" value="${settings.refreshRate}">
                            </div>
                            <div class="fh-setting-group">
                                <div class="fh-label-sm">Notifications</div>
                                <div class="fh-toggle-item">
                                    <span>Wins</span>
                                    <input type="checkbox" id="fh-notify-win" ${settings.notifications.win ? 'checked' : ''}>
                                </div>
                                <div class="fh-toggle-item">
                                    <span>Bets</span>
                                    <input type="checkbox" id="fh-notify-bet" ${settings.notifications.bet ? 'checked' : ''}>
                                </div>
                                <div class="fh-toggle-item">
                                    <span>Losses</span>
                                    <input type="checkbox" id="fh-notify-loss" ${settings.notifications.loss ? 'checked' : ''}>
                                </div>
                                <div class="fh-label-sm" style="margin-top: 10px;">Safeguards</div>
                                <div class="fh-toggle-item">
                                    <span>All-in Warning</span>
                                    <input type="checkbox" id="fh-toggle-allin" ${settings.allInWarning ? 'checked' : ''}>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(root);

        updateStatsUI();

        const canvas = document.getElementById('fh-profit-chart');
        if (canvas) {
            canvas.onmousemove = (e) => {
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;

                let closestIdx = 0;
                let minDist = Infinity;
                const n = profitHistory.length;
                if (n > 0) {
                    for (let i = 0; i < n; i++) {
                        const ptX = n > 1 ? (i / (n - 1)) * rect.width : rect.width / 2;
                        const dist = Math.abs(ptX - mouseX);
                        if (dist < minDist) {
                            minDist = dist;
                            closestIdx = i;
                        }
                    }
                    hoveredPointIndex = closestIdx;
                    renderChart();
                }
            };

            canvas.onmouseleave = () => {
                hoveredPointIndex = null;
                renderChart();
            };
        }

        document.getElementById('fh-refresh-btn').onclick = () => {
            console.log('[FlipHelper Debug] Refresh button clicked');
            resetSession();
        };
        document.getElementById('fh-close-btn').onclick = () => {
            console.log('[FlipHelper Debug] Close button clicked');
            closeUI();
        };
        document.getElementById('fh-discord-btn').onclick = () => {
            console.log('[FlipHelper Debug] Discord button clicked');
            window.open('https://discord.gg/predictors', '_blank');
        };
        document.getElementById('fh-settings-btn').onclick = () => {
            console.log('[FlipHelper Debug] Settings button clicked');
            toggleSettings();
        };
        document.getElementById('fh-back-btn').onclick = () => {
            console.log('[FlipHelper Debug] Back button clicked');
            toggleSettings();
        };

        ['tracker', 'auto', 'predictor'].forEach(name => {
            const btn = document.getElementById(`fh-tab-btn-${name}`);
            if (btn) {
                btn.onclick = () => {
                    switchTab(name);
                };
            }
        });

        const redirectBtn = document.getElementById('fh-predictor-redirect-btn');
        if (redirectBtn) {
            redirectBtn.onclick = () => {
                window.open('https://predictor.best', '_blank');
            };
        }

        document.getElementById('fh-opacity-range').oninput = (e) => {
            const val = e.target.value;
            console.log('[FlipHelper Debug] Opacity range input changed:', val);
            const container = root.querySelector('.fh-container');
            if (container) container.style.backgroundColor = `rgba(44, 44, 44, ${val})`;
            document.getElementById('fh-opacity-val').textContent = Math.round(val * 100) + '%';
            settings.opacity = val;
            saveSettings();
        };

        const refreshRange = document.getElementById('fh-refresh-range');
        refreshRange.oninput = (e) => {
            console.log('[FlipHelper Debug] Refresh range input changed:', e.target.value);
            document.getElementById('fh-refresh-val').textContent = e.target.value + ' ms';
        };
        refreshRange.onchange = (e) => {
            const val = parseInt(e.target.value);
            console.log('[FlipHelper Debug] Refresh range change committed:', val);
            settings.refreshRate = val;
            saveSettings();
            restartUpdateInterval();
        };

        ['win', 'bet', 'loss'].forEach(type => {
            document.getElementById(`fh-notify-${type}`).onchange = (e) => {
                console.log(`[FlipHelper Debug] Notification toggle ${type} changed:`, e.target.checked);
                settings.notifications[type] = e.target.checked;
                saveSettings();
            };
        });

        document.getElementById('fh-toggle-allin').onchange = (e) => {
            console.log('[FlipHelper Debug] All-in Warning toggle changed:', e.target.checked);
            settings.allInWarning = e.target.checked;
            saveSettings();
        };

        const cardBasic = document.getElementById('fh-card-basic');
        const cardChart = document.getElementById('fh-card-chart');
        if (cardBasic && cardChart) {
            cardBasic.onclick = () => {
                if (settings.chartDataViewer) {
                    settings.chartDataViewer = false;
                    saveSettings();
                    cardBasic.classList.add('active');
                    cardChart.classList.remove('active');
                    const container = root.querySelector('.fh-container');
                    if (container) {
                        container.classList.remove('fh-chart-active');
                    }
                    adjustHeight();
                }
            };
            cardChart.onclick = () => {
                if (!settings.chartDataViewer) {
                    settings.chartDataViewer = true;
                    saveSettings();
                    cardChart.classList.add('active');
                    cardBasic.classList.remove('active');
                    const container = root.querySelector('.fh-container');
                    if (container) {
                        container.classList.add('fh-chart-active');
                    }
                    startAnimationLoop();
                    setTimeout(adjustHeight, 100);
                }
            };
        }

        dragElement(root);

        notifContainer = document.createElement('div');
        notifContainer.id = 'fh-notif-container';
        document.body.appendChild(notifContainer);
        bindAutobetEvents();
        console.log('[FlipHelper Debug] injectUI completed');
    }

    function toggleSettings() {
        console.log('[FlipHelper Debug] toggleSettings called');
        const slider = document.getElementById('fh-slider');
        const isSettings = slider.style.transform === 'translateX(-50%)';
        slider.style.transform = isSettings ? 'translateX(0)' : 'translateX(-50%)';
        console.log('[FlipHelper Debug] toggleSettings completed, isSettings target state:', !isSettings);
        adjustHeight();
    }

    function saveSettings() {
        console.log('[FlipHelper Debug] saveSettings called with:', settings);
        if (isContextValid()) {
            chrome.storage.local.set({ settings });
            window.postMessage({ type: 'FH_SETTINGS_UPDATE', settings, activeCurrency }, '*');
            console.log('[FlipHelper Debug] settings successfully sent and saved in local storage');
        } else {
            console.log('[FlipHelper Debug] saveSettings aborted: Context invalid');
        }
    }

    function dragElement(elmnt) {
        console.log('[FlipHelper Debug] dragElement initialized for element:', elmnt);
        let currentX = elmnt.offsetLeft;
        let currentY = elmnt.offsetTop;
        let targetX = currentX;
        let targetY = currentY;
        let isDragging = false;
        let startMouseX = 0;
        let startMouseY = 0;
        let startElemX = 0;
        let startElemY = 0;

        const LERP_FACTOR = 0.15;
        const SINE_AMP = 8;
        const SINE_FREQ = 0.005;

        elmnt.onmousedown = function (e) {
            console.log('[FlipHelper Debug] dragElement mousedown event triggered');
            if (!e.target.closest('.fh-drag-handle')) {
                console.log('[FlipHelper Debug] mousedown ignored: not on drag handle');
                return;
            }
            if (e.target.closest('.fh-btn')) {
                console.log('[FlipHelper Debug] mousedown ignored: clicked on button');
                return;
            }

            isDragging = true;
            elmnt.classList.add('dragging');

            startMouseX = e.clientX;
            startMouseY = e.clientY;
            startElemX = elmnt.offsetLeft;
            startElemY = elmnt.offsetTop;

            currentX = startElemX;
            currentY = startElemY;

            targetX = startElemX;
            targetY = startElemY;

            document.onmousemove = function (e) {
                let newX = startElemX + (e.clientX - startMouseX);
                let newY = startElemY + (e.clientY - startMouseY);

                const minX = -elmnt.offsetWidth + 40;
                const maxX = window.innerWidth - 40;
                const minY = 0;
                const maxY = window.innerHeight - 40;

                targetX = Math.max(minX, Math.min(maxX, newX));
                targetY = Math.max(minY, Math.min(maxY, newY));
                console.log('[FlipHelper Debug] dragElement mousemove, targetX:', targetX, 'targetY:', targetY);
            };

            document.onmouseup = function () {
                console.log('[FlipHelper Debug] dragElement mouseup event triggered');
                isDragging = false;
                elmnt.classList.remove('dragging');
                document.onmousemove = null;
                document.onmouseup = null;

                if (isContextValid()) {
                    chrome.storage.local.set({
                        pos: { top: elmnt.style.top, left: elmnt.style.left }
                    });
                    console.log('[FlipHelper Debug] Position saved:', elmnt.style.top, elmnt.style.left);
                }
            };

            requestAnimationFrame(updatePosition);
        };

        function updatePosition() {
            if (!isDragging && Math.abs(currentX - targetX) < 0.1 && Math.abs(currentY - targetY) < 0.1) {
                return;
            }

            currentX += (targetX - currentX) * LERP_FACTOR;
            currentY += (targetY - currentY) * LERP_FACTOR;

            let sineOffset = 0;
            if (isDragging) {
                const dist = Math.sqrt(Math.pow(targetX - currentX, 2) + Math.pow(targetY - currentY, 2));
                sineOffset = Math.sin(Date.now() * SINE_FREQ) * SINE_AMP * Math.min(dist / 50, 1);
            }

            elmnt.style.left = currentX + "px";
            elmnt.style.top = (currentY + sineOffset) + "px";

            if (isDragging || Math.abs(currentX - targetX) > 0.1) {
                requestAnimationFrame(updatePosition);
            }
        }
    }

    function renderChart() {
        const canvas = document.getElementById('fh-profit-chart');
        if (!canvas) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) return;
        const targetWidth = Math.floor(w * dpr);
        const targetHeight = Math.floor(h * dpr);

        const ctx = canvas.getContext('2d');
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            ctx.scale(dpr, dpr);
        }

        ctx.clearRect(0, 0, w, h);

        if (profitHistory.length === 0) {
            return;
        }

        let maxVal = Math.max(0, ...profitHistory);
        let minVal = Math.min(0, ...profitHistory);
        let range = maxVal - minVal;

        if (range === 0) {
            maxVal = 1;
            minVal = -1;
            range = 2;
        }

        maxVal += range * 0.15;
        minVal -= range * 0.15;
        range = maxVal - minVal;

        const points = [];
        const n = profitHistory.length;
        for (let i = 0; i < n; i++) {
            const x = n > 1 ? (i / (n - 1)) * w : w / 2;
            const y = h - ((profitHistory[i] - minVal) / range) * h;
            points.push({ x, y });
        }

        const yZero = h - ((0 - minVal) / range) * h;

        ctx.strokeStyle = '#3D3D3D';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, yZero);
        ctx.lineTo(w, yZero);
        ctx.stroke();
        ctx.setLineDash([]);

        const zeroPct = Math.max(0, Math.min(1, yZero / h));

        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, 'rgba(0, 191, 99, 0.25)');
        fillGrad.addColorStop(zeroPct, 'rgba(0, 191, 99, 0)');
        fillGrad.addColorStop(zeroPct, 'rgba(255, 75, 75, 0)');
        fillGrad.addColorStop(1, 'rgba(255, 75, 75, 0.2)');

        ctx.fillStyle = fillGrad;
        ctx.beginPath();
        ctx.moveTo(points[0].x, yZero);
        ctx.lineTo(points[0].x, points[0].y);
        if (n === 2) {
            ctx.lineTo(points[1].x, points[1].y);
        } else if (n > 2) {
            for (let i = 0; i < n - 1; i++) {
                const p0 = points[i - 1] || points[i];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[i + 2] || p2;

                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;

                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
        }
        ctx.lineTo(points[points.length - 1].x, yZero);
        ctx.closePath();
        ctx.fill();

        const strokeGrad = ctx.createLinearGradient(0, 0, 0, h);
        strokeGrad.addColorStop(0, '#00BF63');
        strokeGrad.addColorStop(zeroPct, '#00BF63');
        strokeGrad.addColorStop(zeroPct, '#FF4B4B');
        strokeGrad.addColorStop(1, '#FF4B4B');

        ctx.strokeStyle = strokeGrad;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        if (n === 2) {
            ctx.lineTo(points[1].x, points[1].y);
        } else if (n > 2) {
            for (let i = 0; i < n - 1; i++) {
                const p0 = points[i - 1] || points[i];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[i + 2] || p2;

                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;

                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
        }
        ctx.stroke();



        if (hoveredPointIndex !== null && hoveredPointIndex < points.length) {
            const pt = points[hoveredPointIndex];
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(pt.x, h);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 1;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            const val = profitHistory[hoveredPointIndex];
            const text = (val >= 0 ? '+' : '') + val.toFixed(2);
            ctx.font = 'bold 11px Inter, sans-serif';
            const textWidth = ctx.measureText(text).width;
            const padX = 7;
            const padY = 4;
            const tw = textWidth + padX * 2;
            const th = 16 + padY * 2;
            const tx = Math.max(2, Math.min(w - tw - 2, pt.x - tw / 2));
            let ty = pt.y - th - 8;
            if (ty < 2) {
                ty = pt.y + 12;
            }

            ctx.fillStyle = '#1E1E1E';
            ctx.strokeStyle = '#3D3D3D';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tx, ty, tw, th, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = val >= 0 ? '#00BF63' : '#FF4B4B';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, tx + tw / 2, ty + th / 2);
        }
    }

    async function updateProfit() {
        console.log('[FlipHelper Debug] updateProfit called');
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                const data = await response.json();
                const res = extractActiveBalance(data);
                if (res && res.balance !== null) {
                    if (activeCurrency !== null && res.currency !== activeCurrency) {
                        console.log(`[FlipHelper Debug] Ignoring updateProfit fetch result for ${res.currency} because activeCurrency is ${activeCurrency}`);
                        return;
                    }
                    console.log('[FlipHelper Debug] updateProfit fetched user balance successfully:', res.balance);
                    updateProfitFromBalance(res.balance);
                }
            } else {
                console.log('[FlipHelper Debug] updateProfit fetch failed status:', response.status);
            }
        } catch (e) {
            console.log('[FlipHelper Debug] updateProfit fetch failed:', e);
        }
    }

    function updateProfitFromBalance(rawBal, skipNotification = false) {
        if (rawBal === null || typeof rawBal !== 'number') return;
        const bal = Math.round(rawBal * 100) / 100;
        console.log('[FlipHelper State] updateProfitFromBalance: balance =', bal, 'raw =', rawBal, 'startingBalance =', startingBalance, 'lastKnownBalance =', lastKnownBalance);
        if (!skipNotification && lastKnownBalance !== null && bal !== lastKnownBalance) {
            const diff = bal - lastKnownBalance;
            handleBalanceChange(diff);
        }
        lastKnownBalance = bal;

        currentBalance = bal;
        if (isContextValid()) {
            chrome.storage.local.set({ currentBalance: bal });
        }

        if (startingBalance === null) {
            if (getCurrentBalance() === null) {
                console.log('[FlipHelper State] Delaying startingBalance set until DOM balance is rendered');
                return;
            }
            startingBalance = bal;
            console.log('[FlipHelper State] Initial startingBalance set to:', startingBalance);
            if (isContextValid()) {
                chrome.storage.local.set({ startingBalance: bal });
            }
        }

        const profit = currentBalance - startingBalance;

        console.log('[FlipHelper State] Computed profit:', profit, 'isBetActive:', isBetActive, 'pendingHistoryPush:', pendingHistoryPush);

        if (pendingHistoryPush || (isAutobetting && (profitHistory.length === 0 || profitHistory[profitHistory.length - 1] !== profit))) {
            if (!isBetActive || pendingHistoryPush) {
                profitHistory.push(profit);
                if (profitHistory.length > 100) {
                    profitHistory.shift();
                }
                console.log('[FlipHelper History] Pushed profit point:', profit, 'New history:', [...profitHistory]);
                if (isContextValid()) {
                    chrome.storage.local.set({ profitHistory });
                }
                pendingHistoryPush = false;
            }
        }

        updateStatsUI();

        if (settings.chartDataViewer) {
            renderChart();
        }
        console.log('[FlipHelper Debug] updateProfitFromBalance finished');
    }

    function animateValue(el, end, duration, isInteger = false, showSign = false) {
        if (!el) return;

        if (el._animId) {
            cancelAnimationFrame(el._animId);
        }

        let start = el._currentValue;
        if (start === undefined) {
            const txt = el.textContent.replace(/[+]/g, '');
            const parsed = parseFloat(txt);
            start = isNaN(parsed) ? 0 : parsed;
        }
        el._currentValue = end;

        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const ease = progress * (2 - progress);
            const current = start + (end - start) * ease;

            if (isInteger) {
                el.textContent = Math.round(current);
            } else {
                const formatted = current.toFixed(2);
                const sign = (showSign && current >= 0) ? '+' : '';
                el.textContent = sign + formatted;
            }

            if (progress < 1) {
                el._animId = requestAnimationFrame(update);
            } else {
                if (isInteger) {
                    el.textContent = Math.round(end);
                } else {
                    const sign = (showSign && end >= 0) ? '+' : '';
                    el.textContent = sign + end.toFixed(2);
                }
                el._animId = null;
            }
        }

        el._animId = requestAnimationFrame(update);
    }

    function updateStatsUI() {
        const profit = (currentBalance !== null && startingBalance !== null) ? (currentBalance - startingBalance) : 0;

        const profitValEl = document.getElementById('fh-profit-value');
        if (profitValEl) {
            animateValue(profitValEl, profit, 400, false, true);
            const parent = profitValEl.parentElement;
            if (parent) {
                if (profit < 0) {
                    parent.classList.add('negative');
                } else {
                    parent.classList.remove('negative');
                }
            }
        }

        const wageredValEl = document.getElementById('fh-wagered-value');
        if (wageredValEl) {
            animateValue(wageredValEl, wagered, 400, false, false);
        }

        const winsValEl = document.getElementById('fh-wins-value');
        if (winsValEl) {
            animateValue(winsValEl, wins, 400, true, false);
        }

        const lossesValEl = document.getElementById('fh-losses-value');
        if (lossesValEl) {
            animateValue(lossesValEl, losses, 400, true, false);
        }
    }

    async function resetSession() {
        console.log('[FlipHelper Debug] resetSession called');
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                const data = await response.json();
                const res = extractActiveBalance(data);
                let rawBal = res.balance;
                if (rawBal !== null) {
                    const bal = Math.round(rawBal * 100) / 100;
                    startingBalance = bal;
                    profitHistory = [0];
                    wins = 0;
                    losses = 0;
                    wagered = 0;
                    isBetActive = false;
                    pendingHistoryPush = false;
                    if (isContextValid()) {
                        chrome.storage.local.set({ startingBalance: bal, profitHistory: [0], wins: 0, losses: 0, wagered: 0, activeCurrency });
                    }
                    updateProfitFromBalance(rawBal);
                    console.log('[FlipHelper Debug] resetSession startingBalance reset to:', startingBalance);
                } else {
                    console.log('[FlipHelper Debug] resetSession aborted: balance not found');
                }
            } else {
                console.log('[FlipHelper Debug] resetSession fetch failed status:', response.status);
            }
        } catch (e) {
            console.log('[FlipHelper Debug] resetSession fetch failed:', e);
        }
    }

    function closeUI() {
        console.log('[FlipHelper Debug] closeUI called');
        isVisible = false;
        root.classList.remove('visible');
        showNotification();
        if (isContextValid()) {
            chrome.storage.local.set({ isVisible: false });
        }
    }

    function openUI() {
        console.log('[FlipHelper Debug] openUI called');
        isVisible = true;
        root.classList.add('visible');
        hideNotification();
        if (isContextValid()) {
            chrome.storage.local.set({ isVisible: true });
        }
        updateProfit();
        if (settings.chartDataViewer) {
            startAnimationLoop();
        }
    }

    function handleBalanceChange(diff) {
        console.log('[FlipHelper Debug] handleBalanceChange called with diff:', diff);
        if (Date.now() - scriptStartTime < 5000) {
            console.log('[FlipHelper Debug] handleBalanceChange ignored: less than 5s since script start');
            return;
        }

        if (expectedBalance !== null && Math.abs(currentBalance - expectedBalance) < 0.01) {
            console.log('[FlipHelper Debug] handleBalanceChange ignored: matches expectedBalance');
            expectedBalance = null;
            return;
        }

        if (diff > 0) {
            if (settings.notifications.win) {
                showNotification(`WIN: +${diff.toFixed(2)}`, 'win');
            }
        } else if (diff < 0) {
            if (settings.notifications.bet) {
                showNotification(`BET: ${Math.abs(diff).toFixed(2)}`, 'bet');
            }
        }
    }

    function showNotification(message, type = 'info', forceMinimized = false) {
        console.log('[FlipHelper Debug] showNotification called, message:', message, 'type:', type);

        const notif = document.createElement('div');
        notif.className = `fh-notification fh-notif-${type}`;

        let innerHTMLContent = '';
        if (type === 'info' && !message) {
            if (forceMinimized) {
                notif.classList.add('fh-notif-minimized');
                innerHTMLContent = `Open FlipHelper <span class="fh-shortcut">ALT + A</span>`;
                notif.style.opacity = '0.8';
            } else {
                innerHTMLContent = `FlipHelper closed <span class="fh-shortcut">ALT + A</span> to reopen`;
            }
        } else {
            innerHTMLContent = `<span class="fh-notif-badge">${type}</span> ${message}`;
        }

        if (type !== 'info' || message || !forceMinimized) {
            innerHTMLContent += `<div class="fh-notif-progress" style="animation: fh-notif-progress ${type === 'info' && !message ? '4s' : '5s'} linear forwards;"></div>`;
        }

        notif.innerHTML = innerHTMLContent;

        if (notifContainer) {
            notifContainer.appendChild(notif);
        }

        if (type === 'info' && !message) {
            if (!forceMinimized) {
                setTimeout(() => {
                    if (notif.parentNode && !notif.classList.contains('removing')) {
                        notif.style.opacity = '0';
                        setTimeout(() => {
                            notif.classList.add('fh-notif-minimized');
                            notif.innerHTML = `Open FlipHelper <span class="fh-shortcut">ALT + A</span>`;
                            notif.style.opacity = '0.8';
                        }, 300);
                    }
                }, 4000);
            }
        } else {
            setTimeout(() => {
                if (!notif.classList.contains('removing')) {
                    notif.classList.add('removing');
                    setTimeout(() => {
                        if (notif.parentNode) notif.parentNode.removeChild(notif);
                    }, 300);
                }
            }, 5000);
        }
    }

    function hideNotification() {
        console.log('[FlipHelper Debug] hideNotification called');
        if (notifContainer) {
            const infoNotifs = notifContainer.querySelectorAll('.fh-notif-info');
            infoNotifs.forEach(n => {
                if (!n.classList.contains('removing')) {
                    n.classList.add('removing');
                    setTimeout(() => {
                        if (n.parentNode) n.parentNode.removeChild(n);
                    }, 300);
                }
            });
        }
    }



    chrome.storage.local.get(['startingBalance', 'currentBalance', 'isVisible', 'pos', 'settings', 'profitHistory', 'wins', 'losses', 'wagered', 'activeCurrency'], (data) => {
        console.log('[FlipHelper Debug] local storage get returned values:', data);
        if (data.startingBalance !== undefined) {
            startingBalance = data.startingBalance;
        }

        if (data.currentBalance !== undefined) {
            currentBalance = data.currentBalance;
            lastKnownBalance = data.currentBalance;
        }

        if (data.activeCurrency !== undefined) {
            activeCurrency = data.activeCurrency;
        }

        if (data.isVisible === false) {
            isVisible = false;
        }

        if (data.settings) {
            settings = { ...settings, ...data.settings };
        }

        if (data.profitHistory !== undefined) {
            profitHistory = data.profitHistory;
        }

        if (data.wins !== undefined) {
            wins = data.wins;
        }

        if (data.losses !== undefined) {
            losses = data.losses;
        }

        if (data.wagered !== undefined) {
            wagered = data.wagered;
        }

        injectUI();
        updatePageSupport();

        if (!isVisible) {
            root.classList.remove('visible');
            showNotification(undefined, 'info', true);
        }

        const container = root.querySelector('.fh-container');
        if (container) container.style.backgroundColor = `rgba(44, 44, 44, ${settings.opacity})`;

        if (data.pos) {
            let left = parseInt(data.pos.left);
            let top = parseInt(data.pos.top);

            const minX = -300 + 40;
            const maxX = window.innerWidth - 40;
            const minY = 0;
            const maxY = window.innerHeight - 40;

            if (!isNaN(left)) left = Math.max(minX, Math.min(maxX, left));
            if (!isNaN(top)) top = Math.max(minY, Math.min(maxY, top));

            root.style.top = top + 'px';
            root.style.left = left + 'px';
            root.style.right = 'auto';
        }

        if (settings.chartDataViewer) {
            startAnimationLoop();
        }
        setTimeout(adjustHeight, 150);

        window.postMessage({ type: 'FH_SETTINGS_UPDATE', settings, activeCurrency }, '*');
        restartUpdateInterval();
    });

    function restartUpdateInterval() {
        console.log('[FlipHelper Debug] restartUpdateInterval called');
        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(() => {
            if (!isContextValid()) {
                console.log('[FlipHelper Debug] restartUpdateInterval: Context invalid, clearing interval');
                clearInterval(updateIntervalId);
                return;
            }
            updateProfit();
        }, 5000);
    }

    chrome.runtime.onMessage.addListener((msg) => {
        console.log('[FlipHelper Debug] chrome runtime message received:', msg);
        if (msg.action === 'toggle-ui') {
            if (isVisible) closeUI();
            else openUI();
        }
    });

})();
