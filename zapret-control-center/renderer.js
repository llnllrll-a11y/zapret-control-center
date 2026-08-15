const { electronAPI } = window;

// State
let state = {
    zapretPath: 'C:\\zapret',
    strategies: [],
    scores: { version: 1, strategies: {} },
    settings: {
        theme: 'Modern',
        autostart: true,
        networkDetect: true,
        apEnabled: false,
        apHours: 6,
        apThreshold: 50,
        apTopN: 3,
        apCooldown: 30,
        skipVersionApp: '',
        skipVersionZapret: '',
        zapretVersion: 'unknown',
        appVersion: 'v1.0.0'
    },
    activeStrategyName: null,
    isTesting: false,
    selectedStrategy: null,
    networkFingerprint: null,
    providerMemory: {}, // ASN/Fingerprint -> strategy name
    lastApCheck: 0,
    lastApSwitchTime: 0
};

// UI Elements
const el = {
    pathLabel: document.getElementById('label-folder-path'),
    strategiesList: document.getElementById('strategies-list'),
    statusIndicators: document.getElementById('status-indicators'),
    toastContainer: document.getElementById('toast-container'),
    btnStopTest: document.getElementById('btn-stop-test')
};

// Initialize
async function init() {
    const savedSettings = await electronAPI.readSettings();
    if (savedSettings) state.settings = { ...state.settings, ...savedSettings };

    if (savedSettings && savedSettings.providerMemory) {
        state.providerMemory = savedSettings.providerMemory;
    }

    if (savedSettings && savedSettings.zapretPath) {
        state.zapretPath = savedSettings.zapretPath;
    }

    const savedScores = await electronAPI.readScores();
    if (savedScores) state.scores = savedScores;

    applyTheme(state.settings.theme);

    // UI binding
    document.getElementById('setting-theme').value = state.settings.theme;
    document.getElementById('setting-autostart').checked = state.settings.autostart;
    document.getElementById('setting-network-detect').checked = state.settings.networkDetect;
    document.getElementById('setting-ap-hours').value = state.settings.apHours;
    document.getElementById('setting-ap-threshold').value = state.settings.apThreshold;
    document.getElementById('autopilot-toggle').checked = state.settings.apEnabled;

    el.pathLabel.innerText = state.zapretPath;

    await refreshStrategies();

    // Autostart Last Used
    if (state.settings.autostart && state.settings.lastStrategy) {
        const status = await electronAPI.getStatus();
        if (!status.serviceRunning && !status.winwsRunning) {
             const s = state.strategies.find(x => x.shortName === state.settings.lastStrategy);
             if (s) {
                 showToast(`Autostarting ${s.shortName}...`);
                 await window.runStrategy(s.filename, s.shortName);
             }
        }
    }

    // Initial Network Check
    const netInfo = await electronAPI.getNetworkInfo();
    state.networkFingerprint = netInfo.fingerprint;

    // Polling loops
    setInterval(pollStatus, 5000);
    pollStatus();

    setInterval(pollNetworkAndAutopilot, 30000);

    checkUpdates();
}

function showToast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = message;
    el.toastContainer.appendChild(t);
    setTimeout(() => t.style.opacity = '1', 10);
    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
}

async function saveSettings() {
    state.settings.theme = document.getElementById('setting-theme').value;
    state.settings.autostart = document.getElementById('setting-autostart').checked;
    state.settings.networkDetect = document.getElementById('setting-network-detect').checked;
    state.settings.apHours = parseInt(document.getElementById('setting-ap-hours').value);
    state.settings.apThreshold = parseInt(document.getElementById('setting-ap-threshold').value);
    state.settings.zapretPath = state.zapretPath;
    state.settings.providerMemory = state.providerMemory;

    await electronAPI.writeSettings(state.settings);
    applyTheme(state.settings.theme);
    closeModal('modal-settings');
    showToast("Settings saved.");
}

async function saveScores() {
    await electronAPI.writeScores(state.scores);
}

async function refreshStrategies() {
    const valid = await electronAPI.validateZapretPath(state.zapretPath);
    if (!valid) {
        showToast("Zapret Path invalid. Attempting to install...");
        const wantsDownload = confirm("Zapret not found at path. Do you want to download and extract the latest Flowseal release to this folder?");
        if (wantsDownload) {
             showToast("Downloading zapret...");
             const ok = await electronAPI.downloadAndExtractZapret(state.zapretPath);
             if (ok) {
                 showToast("Download and extraction complete.");
                 // Recheck
                 const validNow = await electronAPI.validateZapretPath(state.zapretPath);
                 if (!validNow) {
                     showToast("Still invalid after extraction. Please check path.");
                     el.strategiesList.innerHTML = '';
                     return;
                 }
             } else {
                 showToast("Download failed.");
                 el.strategiesList.innerHTML = '';
                 return;
             }
        } else {
            el.strategiesList.innerHTML = '';
            return;
        }
    }

    state.strategies = await electronAPI.discoverStrategies(state.zapretPath);
    document.getElementById('strategy-count').innerText = `(${state.strategies.length})`;
    renderStrategies();
}

function updateScoreForStrategy(name, result) {
    if (!state.scores.strategies[name]) {
        state.scores.strategies[name] = { score: 0, detailLine: '', history: [] };
    }
    const s = state.scores.strategies[name];
    s.score = result.percentage;
    s.detailLine = result.humanLine;
    s.history.push([result.timestamp, result.percentage]);
    if (s.history.length > 40) s.history.shift();
    saveScores();
    renderStrategies();
}

function renderStrategies() {
    const sorted = [...state.strategies].sort((a,b) => {
        const sa = state.scores.strategies[a.shortName]?.score || 0;
        const sb = state.scores.strategies[b.shortName]?.score || 0;
        return sb - sa;
    });

    el.strategiesList.innerHTML = '';

    for (const strat of sorted) {
        const sData = state.scores.strategies[strat.shortName] || { score: 0, detailLine: 'Not tested', history: [] };

        const card = document.createElement('div');
        card.className = 'card';
        if (state.selectedStrategy === strat.shortName) {
            card.style.borderColor = 'var(--primary-color)';
            card.style.boxShadow = '0 0 10px var(--primary-color)';
        }

        let sparklineSVG = '';
        if (sData.history.length > 1) {
            const minX = sData.history[0][0];
            const maxX = sData.history[sData.history.length-1][0];
            const pts = sData.history.map((h, i) => {
                const x = maxX === minX ? 0 : ((h[0]-minX)/(maxX-minX)) * 150;
                const y = 40 - ((h[1]/100)*40);
                return `${x},${y}`;
            }).join(' ');
            sparklineSVG = `<svg width="150" height="40"><polyline points="${pts}" fill="none" stroke="var(--primary-color)" stroke-width="2"/></svg>`;
        }

        let colorSegmentsHtml = '';
        // Parse the human line for colored segments if available.
        // Format: 🟢 96% ★★★★★ 43ms · DNS 10/10 TCP 10/10 HTTP 7/7 WS 1/1
        const parts = sData.detailLine.split('·');
        if (parts.length > 1) {
            const segsStr = parts[1].trim(); // DNS 10/10 TCP 10/10 HTTP 7/7 WS 1/1
            const segs = segsStr.split(' ');
            let segments = [];
            for (let i = 0; i < segs.length; i += 2) {
                 if (i+1 < segs.length) {
                      const name = segs[i];
                      const valStr = segs[i+1]; // e.g. "10/10"
                      const [val, max] = valStr.split('/').map(Number);
                      let color = 'var(--success-color)';
                      if (val === 0) color = 'var(--danger-color)';
                      else if (val < max) color = 'var(--warning-color)';

                      segments.push(`<span style="background-color: ${color}; padding: 2px 4px; border-radius: 4px; color: white; font-size: 10px; margin-right: 4px;">${name} ${valStr}</span>`);
                 }
            }
            colorSegmentsHtml = `<div style="margin-top: 5px;">${segments.join('')}</div>`;
        }


        card.innerHTML = `
            <div class="card-info" onclick="selectStrategy('${strat.shortName}')" style="cursor:pointer;">
                <div class="card-title">${strat.shortName}</div>
                <div class="card-details">${sData.detailLine}</div>
                ${colorSegmentsHtml}
            </div>
            <div class="sparkline-container">${sparklineSVG}</div>
            <div class="card-score">${sData.score}%</div>
            <div class="card-actions" style="margin-left: 20px;">
                <button onclick="runStrategy('${strat.filename}', '${strat.shortName}')">Run</button>
                <button onclick="testStrategy('${strat.filename}', '${strat.shortName}')">Test</button>
                <button onclick="xrayStrategy('${strat.shortName}')" style="background-color: #555;">X-Ray</button>
            </div>
        `;
        el.strategiesList.appendChild(card);
    }
}

window.selectStrategy = (shortName) => {
    state.selectedStrategy = shortName;
    renderStrategies();
};

async function pollStatus() {
    const status = await electronAPI.getStatus();
    let serviceStr = status.serviceRunning ? '🟢' : '🔴';
    let winwsStr = status.winwsRunning ? '🟢' : '🔴';
    let divertStr = status.winDivertOk ? '🟢' : '🔴';
    state.activeStrategyName = status.activeStrategy;

    el.statusIndicators.innerHTML = `Service: ${serviceStr} | WinWS: ${winwsStr} | Divert: ${divertStr} | Active: ${status.activeStrategy || 'None'}`;
}

async function pollNetworkAndAutopilot() {
    if (state.isTesting) return;

    // Network detect
    if (state.settings.networkDetect) {
        const netInfo = await electronAPI.getNetworkInfo();
        if (netInfo.fingerprint && netInfo.fingerprint !== state.networkFingerprint) {
            showToast(`Network changed: ${netInfo.fingerprint}`);
            state.networkFingerprint = netInfo.fingerprint;

            // Check provider memory
            if (state.providerMemory[netInfo.fingerprint]) {
                const sname = state.providerMemory[netInfo.fingerprint];
                showToast(`For ${netInfo.fingerprint} I remember ${sname}`);
                const strat = state.strategies.find(s => s.shortName === sname);
                if (strat) {
                    await window.runStrategy(strat.filename, strat.shortName);
                }
            } else {
                // Silent auto-find
                document.getElementById('btn-find-best').click();
            }
        }
    }

    // Autopilot
    if (state.settings.apEnabled) {
        const now = Date.now();
        const checkInterval = state.settings.apHours * 60 * 60 * 1000;
        const cooldown = state.settings.apCooldown * 60 * 1000;

        if (now - state.lastApCheck > checkInterval && now - state.lastApSwitchTime > cooldown) {
            state.lastApCheck = now;

            if (state.activeStrategyName) {
                const strat = state.strategies.find(s => s.shortName === state.activeStrategyName);
                if (strat) {
                    const result = await electronAPI.smartCheck();
                    updateScoreForStrategy(strat.shortName, result);

                    const diag = await electronAPI.runDiagnostics(result.measurements);
                    const currentEffective = result.percentage - (5 * diag.dangerCount) - (2 * diag.warningCount);

                    if (currentEffective < state.settings.apThreshold) {
                         showToast(`Autopilot: Quality degraded (eff: ${currentEffective}). Searching alternatives...`);
                         await runAutopilotSwitchLogic(currentEffective);
                    }
                }
            }
        }
    }
}

async function runAutopilotSwitchLogic(currentEffective) {
    state.isTesting = true;
    el.btnStopTest.disabled = false;

    // Candidates: last_good first, then top_n
    let candidates = [];
    if (state.settings.lastGood && state.settings.lastGood !== state.activeStrategyName) {
        const lg = state.strategies.find(s => s.shortName === state.settings.lastGood);
        if (lg) candidates.push(lg);
    }

    // Top N by stored score
    const sorted = [...state.strategies].sort((a,b) => {
        const sa = state.scores.strategies[a.shortName]?.score || 0;
        const sb = state.scores.strategies[b.shortName]?.score || 0;
        return sb - sa;
    });

    for (const s of sorted) {
        if (candidates.length >= state.settings.apTopN + 1) break;
        if (s.shortName !== state.activeStrategyName && !candidates.find(c => c.shortName === s.shortName)) {
            candidates.push(s);
        }
    }

    let switched = false;
    const originalActive = state.activeStrategyName;

    for (const cand of candidates) {
        if (!state.isTesting) break;
        showToast(`Autopilot testing candidate: ${cand.shortName}`);

        await electronAPI.stopAll();
        const args = await electronAPI.parseStrategy(state.zapretPath, cand.filename);
        await electronAPI.startStandalone(state.zapretPath, args);
        await new Promise(r => setTimeout(r, 2000));

        const result = await electronAPI.smartCheck();
        updateScoreForStrategy(cand.shortName, result);

        const diag = await electronAPI.runDiagnostics(result.measurements);
        const candEffective = result.percentage - (5 * diag.dangerCount) - (2 * diag.warningCount);

        if (candEffective >= state.settings.apThreshold && candEffective > currentEffective) {
            showToast(`Autopilot switching to ${cand.shortName} (eff: ${candEffective})`);
            state.settings.lastGood = cand.shortName;
            await saveSettings();
            switched = true;
            state.lastApSwitchTime = Date.now();
            break;
        }
    }

    if (!switched && state.isTesting) {
         showToast("Autopilot: No better candidates found. Rolling back.");
         if (originalActive) {
             const s = state.strategies.find(x => x.shortName === originalActive);
             if (s) await window.runStrategy(s.filename, s.shortName);
         } else {
             await electronAPI.stopAll();
         }
    }

    state.isTesting = false;
    el.btnStopTest.disabled = true;
}


async function checkUpdates() {
    const up = await electronAPI.checkUpdates(state.settings.zapretVersion, state.settings.appVersion);
    if (!up) return;

    if (up.zapret.hasUpdate && up.zapret.latest !== state.settings.skipVersionZapret) {
        const btn = document.getElementById('btn-update-zapret');
        btn.style.display = 'inline-block';
        btn.onclick = () => {
            if (confirm(`Update Zapret to ${up.zapret.latest}? (Click cancel to skip this version)`)) {
                window.open(up.zapret.url);
            } else {
                state.settings.skipVersionZapret = up.zapret.latest;
                saveSettings();
                btn.style.display = 'none';
            }
        };
    }
    if (up.app.hasUpdate && up.app.latest !== state.settings.skipVersionApp) {
        const btn = document.getElementById('btn-update-app');
        btn.style.display = 'inline-block';
        btn.onclick = () => {
             if (confirm(`Update App to ${up.app.latest}? (Click cancel to skip this version)`)) {
                window.open(up.app.url);
            } else {
                state.settings.skipVersionApp = up.app.latest;
                saveSettings();
                btn.style.display = 'none';
            }
        };
    }
}

window.runStrategy = async (filename, shortName) => {
    showToast(`Starting ${shortName}...`);
    const args = await electronAPI.parseStrategy(state.zapretPath, filename);
    if (!args) { showToast("Failed to parse args."); return; }

    const ok = await electronAPI.startStandalone(state.zapretPath, args);
    if (ok) {
        state.activeStrategyName = shortName;
        state.settings.lastStrategy = shortName;
        state.settings.lastGood = shortName;
        if (state.networkFingerprint) {
            state.providerMemory[state.networkFingerprint] = shortName;
        }
        await saveSettings();
        pollStatus();
        showToast("Started standalone.");
    }
};

window.testStrategy = async (filename, shortName) => {
    if (state.isTesting) return;
    state.isTesting = true;
    el.btnStopTest.disabled = false;
    showToast(`Testing ${shortName}...`);

    const wasActive = state.activeStrategyName === shortName;
    if (!wasActive) {
         await electronAPI.stopAll();
         const args = await electronAPI.parseStrategy(state.zapretPath, filename);
         await electronAPI.startStandalone(state.zapretPath, args);
         await new Promise(r => setTimeout(r, 2000));
    }

    const result = await electronAPI.smartCheck();

    updateScoreForStrategy(shortName, result);
    showToast(`Test finished: ${result.percentage}%`);

    state.isTesting = false;
    el.btnStopTest.disabled = true;
};

window.xrayStrategy = async (shortName) => {
    const sData = state.scores.strategies[shortName];
    if (!sData || !sData.detailLine) {
        showToast("Run a test first to generate X-Ray data.");
        return;
    }

    document.getElementById('diag-content').innerHTML = `<h3>X-Ray Results for ${shortName}</h3><p>Score: ${sData.score}%</p><p>${sData.detailLine}</p>`;
    openModal('modal-diagnostics');
};

document.getElementById('btn-change-folder').addEventListener('click', async () => {
    const path = await electronAPI.openDirectory();
    if (path) {
        state.zapretPath = path;
        el.pathLabel.innerText = path;
        await saveSettings();
        refreshStrategies();
    }
});

document.getElementById('btn-stop-all').addEventListener('click', async () => {
    showToast("Stopping all processes...");
    await electronAPI.stopAll();
    pollStatus();
});

document.getElementById('btn-install-service').addEventListener('click', async () => {
    if (!state.selectedStrategy) {
        showToast("Select a strategy from the list first.");
        return;
    }
    const strat = state.strategies.find(s => s.shortName === state.selectedStrategy);
    const args = await electronAPI.parseStrategy(state.zapretPath, strat.filename);
    showToast("Installing service. Please accept UAC prompt...");
    const ok = await electronAPI.installService(state.zapretPath, args, strat.shortName);
    if (ok) showToast("Service installed!");
    else showToast("Service install failed.");
    pollStatus();
});

document.getElementById('btn-remove-service').addEventListener('click', async () => {
    showToast("Removing service. Please accept UAC prompt...");
    const ok = await electronAPI.removeService();
    if (ok) showToast("Service removed!");
    pollStatus();
});

document.getElementById('btn-refresh').addEventListener('click', refreshStrategies);
document.getElementById('btn-settings').addEventListener('click', () => openModal('modal-settings'));
document.getElementById('btn-lists').addEventListener('click', () => {
    openModal('modal-lists');
    loadList();
});
document.getElementById('btn-diagnostics').addEventListener('click', () => openModal('modal-diagnostics'));
document.getElementById('btn-log').addEventListener('click', async () => {
    const log = await electronAPI.readLog();
    document.getElementById('log-viewer').value = log;
    openModal('modal-log');
});
document.getElementById('btn-minimize').addEventListener('click', () => { electronAPI.minimizeToTray(); });

document.getElementById('autopilot-toggle').addEventListener('change', async (e) => {
    state.settings.apEnabled = e.target.checked;
    await saveSettings();
    showToast(state.settings.apEnabled ? "Autopilot Enabled" : "Autopilot Disabled");
});

document.getElementById('btn-find-best').addEventListener('click', async () => {
    if (state.isTesting) return;
    state.isTesting = true;
    el.btnStopTest.disabled = false;
    showToast("Starting Auto-find...");

    let best = null;
    let bestScore = -1;
    const originalActive = state.activeStrategyName;

    for (let i = 0; i < state.strategies.length; i++) {
        if (!state.isTesting) break;
        const strat = state.strategies[i];
        showToast(`Testing [${i+1}/${state.strategies.length}]: ${strat.shortName}`);

        await electronAPI.stopAll();
        const args = await electronAPI.parseStrategy(state.zapretPath, strat.filename);
        await electronAPI.startStandalone(state.zapretPath, args);
        await new Promise(r => setTimeout(r, 2000));

        const result = await electronAPI.smartCheck();
        updateScoreForStrategy(strat.shortName, result);

        const diag = await electronAPI.runDiagnostics(result.measurements);
        const effectiveScore = result.percentage - (5 * diag.dangerCount) - (2 * diag.warningCount);

        if (effectiveScore > bestScore) {
            bestScore = effectiveScore;
            best = strat;
        }

        if (effectiveScore >= 70) {
            showToast(`Found good strategy: ${strat.shortName} (eff: ${effectiveScore})`);
            break;
        }
    }

    if (best && state.isTesting) {
         showToast(`Auto-find complete. Best is ${best.shortName}.`);
         selectStrategy(best.shortName);
         await window.runStrategy(best.filename, best.shortName);
    } else if (originalActive && state.isTesting) {
         showToast("Rolling back to original.");
         const s = state.strategies.find(x => x.shortName === originalActive);
         if (s) await window.runStrategy(s.filename, s.shortName);
    }

    state.isTesting = false;
    el.btnStopTest.disabled = true;
});

document.getElementById('btn-stop-test').addEventListener('click', () => {
    state.isTesting = false;
    el.btnStopTest.disabled = true;
    showToast("Testing stopped.");
});

window.runDiagnosticsBtn = async () => {
    document.getElementById('diag-content').innerHTML = "Running tests...";
    const check = await electronAPI.smartCheck();
    const diag = await electronAPI.runDiagnostics(check.measurements);

    let html = `<h3>System</h3>`;
    html += `BFE Service: ${diag.system.bfeRunning ? '🟢 Running' : '🔴 Stopped'}<br>`;
    html += `System Proxy: ${diag.system.proxyEnabled ? '🔴 Enabled (Warning)' : '🟢 Disabled'}<br>`;
    html += `VPN: ${diag.system.vpnRunning ? '🔴 Running (Warning)' : '🟢 None'}<br>`;

    html += `<h3>X-Ray Findings</h3><ul>`;
    for (const f of diag.findings) {
        let color = f.level === 'danger' ? 'var(--danger-color)' : (f.level === 'warning' ? 'var(--warning-color)' : (f.level === 'ok' ? 'var(--success-color)' : 'var(--text-color)'));
        html += `<li style="color:${color}">${f.message}</li>`;
    }
    html += `</ul>`;

    document.getElementById('diag-content').innerHTML = html;
};

window.loadList = async () => {
    const filename = document.getElementById('list-selector').value;
    const fullPath = `${state.zapretPath}\\lists\\${filename}`;
    const content = await electronAPI.readList(fullPath);
    document.getElementById('list-editor').value = content;
};

window.saveList = async () => {
    const filename = document.getElementById('list-selector').value;
    const fullPath = `${state.zapretPath}\\lists\\${filename}`;
    const content = document.getElementById('list-editor').value;
    const ok = await electronAPI.writeList(fullPath, content);
    if (ok) showToast("List saved!");
    else showToast("Failed to save list.");
};

init();
