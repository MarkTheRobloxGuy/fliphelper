(function() {
    function getCurrentBalance() {
        console.log('[FlipHelper Debug] getCurrentBalance entered');
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
                    console.log('[FlipHelper Debug] getCurrentBalance returning:', val, 'from selector:', sel);
                    return val;
                }
            }
        }
        console.log('[FlipHelper Debug] getCurrentBalance returning null');
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
                activeCurrency = domCurrency;
                return { balance: domCurrency === 'FLIPCOINS' ? flipcoins : rocoins, currency: domCurrency };
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

    let activeCurrency = null;
    let allInWarningEnabled = true;
    const pendingAllInRequests = {};
    let reqIdCounter = 0;

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        
        console.log('[FlipHelper Debug] window message event received in inject.js:', event.data.type, event.data);

        if (event.data.type === 'FH_SETTINGS_UPDATE') {
            allInWarningEnabled = event.data.settings.allInWarning;
            if (event.data.activeCurrency !== undefined) {
                activeCurrency = event.data.activeCurrency;
            }
            console.log('[FlipHelper Debug] FH_SETTINGS_UPDATE: allInWarningEnabled =', allInWarningEnabled, 'activeCurrency =', activeCurrency);
            return;
        }

        if (event.data.type !== 'FH_ALL_IN_RESPONSE') {
            console.log('[FlipHelper Debug] message event ignored (not FH_ALL_IN_RESPONSE)');
            return;
        }
        const reqId = event.data.reqId;
        if (pendingAllInRequests[reqId]) {
            console.log('[FlipHelper Debug] Processing pending all-in request id:', reqId, 'action:', event.data.action);
            if (event.data.action === 'ALLOW') {
                pendingAllInRequests[reqId].resolve();
            } else {
                pendingAllInRequests[reqId].reject(new Error("All-in bet blocked by user."));
            }
            delete pendingAllInRequests[reqId];
        } else {
            console.log('[FlipHelper Debug] No pending request found for reqId:', reqId);
        }
    });

    function checkAllIn(url, reqBody) {
        console.log('[FlipHelper Debug] checkAllIn entered for url:', url);
        if (!allInWarningEnabled) {
            console.log('[FlipHelper Debug] checkAllIn skipped: warning not enabled');
            return null;
        }
        if (!url.includes('games/mines') && !url.includes('games/towers') && !url.includes('games/dice')) {
            console.log('[FlipHelper Debug] checkAllIn skipped: url not matching games');
            return null;
        }
        
        const bet = reqBody && (reqBody.betAmount || reqBody.amount || reqBody.bet);
        if (bet !== undefined && bet !== null) {
            const currentBalance = getCurrentBalance();
            console.log('[FlipHelper Debug] checkAllIn checking bet:', bet, 'against balance:', currentBalance);
            if (currentBalance !== null && bet >= (currentBalance * 0.80)) {
                console.log('[FlipHelper Debug] checkAllIn balance warning triggered!');
                return currentBalance;
            }
        }
        return null;
    }

    function handleApiResponse(url, reqBody, data) {
        console.log('[FlipHelper Debug] handleApiResponse entered for url:', url);
        if (!url || !data) {
            console.log('[FlipHelper Debug] handleApiResponse missing url or data');
            return;
        }

        if (url.includes('api/user')) {
            console.log('[FlipHelper Interceptor] User API matched:', url);
            const res = extractActiveBalance(data);
            if (res && res.balance !== null) {
                console.log('[FlipHelper Interceptor] Extracted User Balance:', res.balance, 'currency:', res.currency);
                window.postMessage({ type: 'FH_BALANCE_UPDATE', balance: res.balance, currency: res.currency }, '*');
            } else {
                console.log('[FlipHelper Interceptor] User API balance fields not found');
            }
            return;
        }

        const isMines = url.includes('games/mines') && !url.includes('history');
        const isTowers = url.includes('games/towers') && !url.includes('history');
        const isDice = url.includes('games/dice') && !url.includes('history');

        if (!isMines && !isTowers && !isDice) {
            console.log('[FlipHelper Debug] handleApiResponse: URL does not match game endpoints');
            return;
        }

        console.log('[FlipHelper Interceptor] Game API matched:', url);

        const isAction = url.includes('/action');
        const betAmount = reqBody && (reqBody.betAmount || reqBody.amount || reqBody.bet);
        const parsedBetAmount = parseFloat(betAmount);
        const hasValidBet = !isNaN(parsedBetAmount) && parsedBetAmount > 0;

        if (isDice) {
            const isWin = data.win || data.isWin || data.hasWon || (data.payout && data.payout > 0);
            const payout = data.payout || data.winningAmount || data.payoutAmount || 0;
            
            if (hasValidBet && parsedBetAmount >= 0.10) {
                console.log('[FlipHelper Interceptor] Dice Bet Amount:', parsedBetAmount);
                window.postMessage({ type: 'FH_GAME_ACTION', action: 'bet', amount: parsedBetAmount }, '*');
            }
            
            if (isWin) {
                if (payout >= 0.10) {
                    console.log('[FlipHelper Interceptor] Dice Win payout:', payout);
                    window.postMessage({ type: 'FH_GAME_ACTION', action: 'win', amount: payout }, '*');
                }
            } else {
                const lossAmt = hasValidBet ? parsedBetAmount : 0;
                if (lossAmt >= 0.10) {
                    console.log('[FlipHelper Interceptor] Dice Loss');
                    window.postMessage({ type: 'FH_GAME_ACTION', action: 'loss', amount: lossAmt }, '*');
                }
            }
        } else if (isMines || isTowers) {
            if (isAction) {
                const isCashout = reqBody?.cashout || reqBody?.action === 'cashout' || data.state === 'cashout' || data.cashedOut || data.cashout;
                const exploded = data.exploded || data.state === 'exploded' || data.hasWon === false;
                
                if (isCashout) {
                    const winnings = data.winningAmount || data.payout || data.winnings || data.game?.winningAmount || data.game?.payout || 0;
                    if (winnings >= 0.10) {
                        console.log('[FlipHelper Interceptor] Mines/Towers Cashout Win:', winnings);
                        window.postMessage({ type: 'FH_GAME_ACTION', action: 'win', amount: winnings }, '*');
                    }
                } else if (exploded) {
                    console.log('[FlipHelper Interceptor] Mines/Towers Exploded Loss');
                    window.postMessage({ type: 'FH_GAME_ACTION', action: 'loss', amount: 0 }, '*');
                } else {
                    console.log('[FlipHelper Interceptor] Mines/Towers action was neither cashout nor exploded');
                }
            } else {
                if (hasValidBet && parsedBetAmount >= 0.10) {
                    console.log('[FlipHelper Interceptor] Mines/Towers Bet Started:', parsedBetAmount);
                    window.postMessage({ type: 'FH_GAME_ACTION', action: 'bet', amount: parsedBetAmount }, '*');
                } else {
                    console.log('[FlipHelper Interceptor] Mines/Towers game request has no valid bet amount');
                }
            }
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        console.log('[FlipHelper Debug] fetch intercepted url:', url);
        
        let reqBody = null;
        try {
            if (args[1] && args[1].body && typeof args[1].body === 'string') {
                reqBody = JSON.parse(args[1].body);
            }
        } catch(e){}

        const balance = checkAllIn(url, reqBody);
        if (balance !== null) {
            console.log('[FlipHelper Debug] fetch triggering all-in check promise for:', url);
            try {
                await new Promise((resolve, reject) => {
                    const reqId = ++reqIdCounter;
                    pendingAllInRequests[reqId] = { resolve, reject };
                    window.postMessage({ type: 'FH_ALL_IN_WARNING', reqId: reqId, balance: balance }, '*');
                });
            } catch (err) {
                console.log('[FlipHelper Debug] fetch all-in promise rejected:', err);
                return new Response(JSON.stringify({ error: err.message }), { status: 400 });
            }
        }

        const response = await originalFetch.apply(this, args);
        
        const isMatchedApi = url.includes('api/user') || url.includes('games/mines') || url.includes('games/towers') || url.includes('games/dice');
        if (isMatchedApi) {
            try {
                const clonedResponse = response.clone();
                clonedResponse.json().then(data => {
                    console.log('[FlipHelper Debug] API Request:', url);
                    console.log('[FlipHelper Debug] Request Body:', reqBody);
                    console.log('[FlipHelper Debug] Response Data:', data);
                    handleApiResponse(url, reqBody, data);
                }).catch(e => {
                    console.log('[FlipHelper Debug] fetch JSON parsing failed:', e);
                });
            } catch (e) {
                console.log('[FlipHelper Debug] fetch response clone failed:', e);
            }
        }

        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._url = typeof url === 'string' ? url : (url ? url.href : '');
        console.log('[FlipHelper Debug] XMLHttpRequest open intercepted method:', method, 'url:', this._url);
        return originalOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(body) {
        let reqBody = null;
        if (body && typeof body === 'string') {
            try { reqBody = JSON.parse(body); } catch(e){}
        }

        const url = this._url || '';
        console.log('[FlipHelper Debug] XMLHttpRequest send intercepted url:', url, 'body:', reqBody);
        const balance = checkAllIn(url, reqBody);
        const args = arguments;

        const proceed = () => {
            console.log('[FlipHelper Debug] XMLHttpRequest proceed called');
            const isMatchedApi = url.includes('api/user') || url.includes('games/mines') || url.includes('games/towers') || url.includes('games/dice');
            if (isMatchedApi) {
                this.addEventListener('load', function() {
                    try {
                        console.log('[FlipHelper Debug XHR] API Request:', url);
                        console.log('[FlipHelper Debug XHR] Request Body:', reqBody);
                        
                        let data = null;
                        try { 
                            data = JSON.parse(this.responseText); 
                        } catch(e){
                            console.log('[FlipHelper Debug XHR] JSON parse failed:', e);
                        }
                        if (!data) {
                            console.log('[FlipHelper Debug XHR] Response data is empty');
                            return;
                        }
                        
                        console.log('[FlipHelper Debug XHR] Response Data:', data);
                        handleApiResponse(url, reqBody, data);
                    } catch(e) {
                        console.log('[FlipHelper Debug XHR] load listener failed:', e);
                    }
                });
            }
            originalSend.apply(this, args);
        };
        
        if (balance !== null) {
            console.log('[FlipHelper Debug] XMLHttpRequest send triggering all-in check promise for:', url);
            const reqId = ++reqIdCounter;
            pendingAllInRequests[reqId] = { 
                resolve: proceed,
                reject: () => {
                    console.log('[FlipHelper Debug] XMLHttpRequest all-in check rejected request id:', reqId);
                    this.abort();
                }
            };
            window.postMessage({ type: 'FH_ALL_IN_WARNING', reqId: reqId, balance: balance }, '*');
            return;
        }

        proceed();
    };

    const wrapHistory = (type) => {
        const orig = history[type];
        return function(...args) {
            const res = orig.apply(this, args);
            window.postMessage({ type: 'FH_URL_CHANGE', url: window.location.href }, '*');
            return res;
        };
    };
    history.pushState = wrapHistory('pushState');
    history.replaceState = wrapHistory('replaceState');
    window.addEventListener('popstate', () => {
        window.postMessage({ type: 'FH_URL_CHANGE', url: window.location.href }, '*');
    });
    window.postMessage({ type: 'FH_URL_CHANGE', url: window.location.href }, '*');

})();

