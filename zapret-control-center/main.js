const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Global / System Behavior
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

// Data paths next to the executable
const isPackaged = app.isPackaged;
const appDir = isPackaged ? path.dirname(process.execPath) : __dirname;

const settingsPath = path.join(appDir, 'zcc_settings.json');
const scoresPath = path.join(appDir, 'zapret_scores.json');
const logPath = path.join(appDir, 'zcc_log.txt');
const crashPath = path.join(appDir, 'zcc_crash.log');

// Setup logging
function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(logPath, line);
    // basic log rotation: keep 7 days - we can implement cleanup later
  } catch (e) {
    console.error("Failed to write to log", e);
  }
}

// Crash trap
process.on('uncaughtException', (error) => {
  const msg = `Uncaught Exception:\n${error.stack || error}\n`;
  try {
    fs.appendFileSync(crashPath, `[${new Date().toISOString()}] ${msg}`);
  } catch(e) {}

  if (app.isReady()) {
    dialog.showErrorBox('Zapret Control Center Crash', `A fatal error occurred. Log written to zcc_crash.log.\n\n${error.message}`);
  }
  process.exit(1);
});

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'icon.ico'),
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Window', click: () => mainWindow.show() },
    { label: 'Stop all', click: () => {
        log("Tray: Stop all clicked");
        // We will implement stop all logic later
    }},
    { type: 'separator' },
    { label: 'Exit', click: () => {
        app.isQuiting = true;
        app.quit();
    }}
  ]);
  tray.setToolTip('Zapret Control Center');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  log("App starting...");
  createWindow();
  createTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Persistence Logic for Scores
function getScores() {
  try {
    if (fs.existsSync(scoresPath)) {
      const data = fs.readFileSync(scoresPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    log("Failed to parse scores: " + e.message);
  }
  return { version: 1, strategies: {} };
}

function saveScores(scores) {
  try {
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
  } catch (e) {
    log("Failed to save scores: " + e.message);
  }
}

// IPC Channels for Renderer
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) return null;
  return filePaths[0];
});

ipcMain.handle('validate-zapret-path', async (event, folderPath) => {
  if (!folderPath) return false;
  try {
    const serviceBat = path.join(folderPath, 'service.bat');
    const winwsExe = path.join(folderPath, 'bin', 'winws.exe');
    return fs.existsSync(serviceBat) && fs.existsSync(winwsExe);
  } catch (e) {
    return false;
  }
});

ipcMain.handle('discover-strategies', async (event, folderPath) => {
  if (!folderPath) return [];
  try {
    const files = fs.readdirSync(folderPath);
    const strategies = [];

    for (const file of files) {
      if (file.toLowerCase().startsWith('general') && file.toLowerCase().endsWith('.bat')) {
        let shortName = file.substring(7, file.length - 4); // strip "general" and ".bat"
        shortName = shortName.replace(/[()]/g, '').trim().toUpperCase();
        if (shortName === '') shortName = 'GENERAL';

        strategies.push({
          filename: file,
          shortName: shortName,
          fullPath: path.join(folderPath, file)
        });
      }
    }
    return strategies;
  } catch (e) {
    log("Discover strategies error: " + e.message);
    return [];
  }
});

// Helper to parse arguments
ipcMain.handle('parse-strategy', async (event, folderPath, filename) => {
  try {
    const fullPath = path.join(folderPath, filename);
    if (!fs.existsSync(fullPath)) return null;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    let joinedStr = '';

    // Join lines ending with ^
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].replace('\r', '').trim();
      if (line.endsWith('^')) {
        joinedStr += line.slice(0, -1) + ' ';
      } else {
        joinedStr += line + '\n';
      }
    }

    let args = '';
    const joinedLines = joinedStr.split('\n');
    for (const line of joinedLines) {
      const winwsIndex = line.indexOf('winws.exe');
      if (winwsIndex !== -1) {
        // capture everything after winws.exe
        let after = line.substring(winwsIndex + 'winws.exe'.length);

        // up to the first of (echo/call/exit/pause/goto)
        const stops = [' echo ', ' call ', ' exit ', ' pause ', ' goto ', '||', '&&'];
        let stopIndex = -1;
        for (const stop of stops) {
          const idx = after.indexOf(stop);
          if (idx !== -1 && (stopIndex === -1 || idx < stopIndex)) {
            stopIndex = idx;
          }
        }
        if (stopIndex !== -1) {
          after = after.substring(0, stopIndex);
        }

        args = after;
        break;
      }
    }

    args = args.replace(/\s+/g, ' ').trim();

    // Substitute placeholders
    args = args.replace(/%BIN%/g, path.join(folderPath, 'bin') + '\\');
    args = args.replace(/%LISTS%/g, path.join(folderPath, 'lists') + '\\');

    // GameFilter substitution
    let gameFilterMode = 'off';
    const gfFile = path.join(folderPath, 'utils', 'game_filter.enabled');
    if (fs.existsSync(gfFile)) {
       gameFilterMode = fs.readFileSync(gfFile, 'utf-8').trim().toLowerCase();
    }

    if (gameFilterMode === 'off') {
        args = args.replace(/%GameFilterTCP%/gi, '12');
        args = args.replace(/%GameFilterUDP%/gi, '12');
        args = args.replace(/%GameFilter%/gi, '12');
    } else if (gameFilterMode === 'all') {
        args = args.replace(/%GameFilterTCP%/gi, '1024-65535');
        args = args.replace(/%GameFilterUDP%/gi, '1024-65535');
        args = args.replace(/%GameFilter%/gi, '1024-65535');
    } else if (gameFilterMode === 'tcp') {
        args = args.replace(/%GameFilterTCP%/gi, '1024-65535');
        args = args.replace(/%GameFilterUDP%/gi, '12');
        args = args.replace(/%GameFilter%/gi, 'tcp=1024-65535,udp=12');
    } else if (gameFilterMode === 'udp') {
        args = args.replace(/%GameFilterTCP%/gi, '12');
        args = args.replace(/%GameFilterUDP%/gi, '1024-65535');
        args = args.replace(/%GameFilter%/gi, 'tcp=12,udp=1024-65535');
    }

    return args;
  } catch (e) {
    log("Parse strategy error: " + e.message);
    return null;
  }
});

const fetch = require('node-fetch');

// Updates
ipcMain.handle('check-updates', async (event, currentZapretVersion, currentAppVersion) => {
  try {
    const zapretResp = await fetch('https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest');
    const zapretData = await zapretResp.json();

    const appResp = await fetch('https://api.github.com/repos/zapret-control-center/zapret-control-center/releases/latest'); // Using dummy repo for app
    const appData = await appResp.ok ? await appResp.json() : { tag_name: 'v1.0.0' }; // fallback

    return {
      zapret: {
        latest: zapretData.tag_name,
        hasUpdate: zapretData.tag_name !== currentZapretVersion,
        url: zapretData.html_url
      },
      app: {
        latest: appData.tag_name,
        hasUpdate: appData.tag_name !== currentAppVersion,
        url: appData.html_url
      }
    };
  } catch (e) {
    log("Check updates error: " + e.message);
    return null;
  }
});
const { exec, spawn } = require('child_process');
const sudo = require('sudo-prompt');

let winwsProcess = null;

// Start/Stop Standalone
ipcMain.handle('start-standalone', async (event, folderPath, args) => {
  log("Starting standalone: " + args);
  try {
    if (winwsProcess) {
       winwsProcess.kill();
       winwsProcess = null;
    }
    const binPath = path.join(folderPath, 'bin');
    const exePath = path.join(binPath, 'winws.exe');

    // Using simple space split for arguments for simplicity, a real parser might be needed for quoted paths
    const argsArray = args.match(/(?:[^\s"]+|"[^"]*")+/g).map(s => s.replace(/"/g, ''));

    winwsProcess = spawn(exePath, argsArray, {
      cwd: binPath,
      windowsHide: true,
      detached: true
    });

    winwsProcess.on('error', (err) => {
      log("winws start error: " + err);
    });

    winwsProcess.on('close', (code) => {
      log(`winws process exited with code ${code}`);
      winwsProcess = null;
    });

    return true;
  } catch(e) {
    log("Start standalone failed: " + e.message);
    return false;
  }
});

ipcMain.handle('stop-all', async () => {
  log("Stopping all...");
  try {
    if (winwsProcess) {
        winwsProcess.kill('SIGKILL');
        winwsProcess = null;
    }

    exec('net stop zapret', (err) => {
      exec('taskkill /IM winws.exe /F', (err2) => {
        exec('net stop WinDivert', (err3) => {
          exec('net stop WinDivert14', (err4) => {
             log("Stop all commands executed.");
          });
        });
      });
    });
    return true;
  } catch(e) {
    log("Stop all error: " + e.message);
    return false;
  }
});

// Service Management
ipcMain.handle('install-service', async (event, folderPath, args, strategyName) => {
  log("Installing service for strategy: " + strategyName);
  return new Promise((resolve) => {
    const exePath = path.join(folderPath, 'bin', 'winws.exe');
    const binPath = `\\"${exePath}\\" ${args}`;

    const cmds = [
      `sc.exe delete zapret`,
      `sc.exe create zapret binPath= "${binPath}" DisplayName= zapret start= auto`,
      `sc.exe description zapret "Zapret DPI bypass software"`,
      `sc.exe start zapret`,
      `reg add HKLM\\System\\CurrentControlSet\\Services\\zapret /v zapret-discord-youtube /t REG_SZ /d "${strategyName}" /f`
    ];

    const batchCmd = cmds.join(' & ');

    sudo.exec(batchCmd, { name: 'Zapret Control Center' }, (error, stdout, stderr) => {
      if (error) {
        log("Install service error: " + error);
        resolve(false);
      } else {
        log("Install service success: " + stdout);
        resolve(true);
      }
    });
  });
});

ipcMain.handle('remove-service', async () => {
  log("Removing service...");
  return new Promise((resolve) => {
    const cmds = [
      `net stop zapret`,
      `sc delete zapret`,
      `taskkill /IM winws.exe /F`,
      `net stop WinDivert`,
      `sc delete WinDivert`,
      `net stop WinDivert14`,
      `sc delete WinDivert14`
    ];
    const batchCmd = cmds.join(' & ');

    sudo.exec(batchCmd, { name: 'Zapret Control Center' }, (error, stdout, stderr) => {
      if (error) {
         log("Remove service error: " + error);
         resolve(false);
      } else {
         log("Remove service success.");
         resolve(true);
      }
    });
  });
});

// Status Polling
function execPromise(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve(stdout ? stdout.toString() : '');
    });
  });
}

ipcMain.handle('get-status', async () => {
  try {
    const scQuery = await execPromise('sc query zapret');
    const isServiceRunning = scQuery.includes('RUNNING');

    const tasklist = await execPromise('tasklist /FI "IMAGENAME eq winws.exe"');
    const isWinwsRunning = tasklist.includes('winws.exe');

    const wdQuery = await execPromise('sc query WinDivert');
    const wd14Query = await execPromise('sc query WinDivert14');
    const isWinDivertOk = wdQuery.includes('RUNNING') || wd14Query.includes('RUNNING');

    let activeStrategy = null;
    if (isServiceRunning) {
        const regQuery = await execPromise('reg query HKLM\\System\\CurrentControlSet\\Services\\zapret /v zapret-discord-youtube');
        const match = regQuery.match(/zapret-discord-youtube\s+REG_SZ\s+(.*)/);
        if (match) activeStrategy = match[1].trim();
    }

    return {
      serviceRunning: isServiceRunning,
      winwsRunning: isWinwsRunning,
      winDivertOk: isWinDivertOk,
      activeStrategy: activeStrategy
    };
  } catch(e) {
    return { serviceRunning: false, winwsRunning: false, winDivertOk: false, activeStrategy: null };
  }
});
const dns = require('dns');
const net = require('net');
const https = require('https');
const dgram = require('dgram');

// Measurement Engine / Smart Check
async function measureHost(host) {
    let results = {
        dnsSystem: false,
        dnsDoH: false,
        tcp: 0, // out of 2
        http: false,
        ws: null, // used only for discord gateway
        latency: 0
    };

    // DNS System
    try {
        await new Promise((resolve, reject) => {
            dns.lookup(host, (err, address) => {
                if (err) reject(err);
                else resolve(address);
            });
        });
        results.dnsSystem = true;
    } catch(e) {}

    // DNS 8.8.8.8 (simple UDP DNS query approximation)
    // In a real app we'd construct a DNS packet, but here we just try to resolve it.
    // We will simulate it using a standard lookup for simplicity unless we pull in a DNS packet library.
    // For exactness, we can use a small manual packet or an external API as a fallback.
    // We will do a generic lookup for now, in a robust implementation we'd craft the UDP packet.
    try {
        await new Promise((resolve, reject) => {
             const resolver = new dns.promises.Resolver();
             resolver.setServers(['8.8.8.8']);
             resolver.resolve4(host).then(resolve).catch(reject);
        });
        results.dnsDoH = true;
    } catch(e) {}

    // TCP Connect :443 (twice)
    let latencies = [];
    for(let i=0; i<2; i++) {
        try {
            const start = Date.now();
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(2000);
                socket.on('timeout', () => { socket.destroy(); reject(); });
                socket.on('error', (err) => { reject(); });
                socket.connect(443, host, () => {
                    latencies.push(Date.now() - start);
                    results.tcp++;
                    socket.destroy();
                    resolve();
                });
            });
        } catch(e) {}
    }

    // HTTP GET (HTTPS)
    try {
        const start = Date.now();
        await new Promise((resolve, reject) => {
            const req = https.get(`https://${host}`, { timeout: 2000 }, (res) => {
                if(res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 400 || res.statusCode === 403) {
                    latencies.push(Date.now() - start);
                    results.http = true;
                    resolve();
                } else {
                    reject();
                }
            });
            req.on('timeout', () => { req.destroy(); reject(); });
            req.on('error', (err) => { reject(); });
        });
    } catch(e) {}

    // Discord Gateway WS check
    if (host === 'gateway.discord.gg') {
        try {
            await new Promise((resolve, reject) => {
                const req = https.get(`https://${host}/?v=10&encoding=json`, { timeout: 2000 }, (res) => {
                   results.ws = true; // rough approximation for WS handshake upgrade success
                   resolve();
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(); });
            });
        } catch(e) {
            results.ws = false;
        }
    }

    if (latencies.length > 0) {
        results.latency = latencies.reduce((a,b)=>a+b,0) / latencies.length;
    }

    return results;
}

ipcMain.handle('smart-check', async () => {
    log("Running Smart Check...");
    const hosts = ['youtube.com', 'googlevideo.com', 'discord.com', 'gateway.discord.gg'];
    let measurements = {};
    for (const host of hosts) {
        measurements[host] = await measureHost(host);
    }

    let dnsScore = 0, tcpScore = 0, httpScore = 0, wsScore = 0;
    let latencies = [];

    for (const host of hosts) {
        const m = measurements[host];
        if (m.dnsSystem || m.dnsDoH) dnsScore += 2.5; // 4 hosts * 2.5 = 10
        if (m.tcp > 0) tcpScore += (m.tcp / 2) * 2.5; // 4 hosts * 2.5 = 10
        if (m.http) httpScore += (7 / 4); // 4 hosts
        if (host === 'gateway.discord.gg' && m.ws) wsScore += 1;
        if (m.latency > 0) latencies.push(m.latency);
    }

    dnsScore = Math.round(dnsScore);
    tcpScore = Math.round(tcpScore);
    httpScore = Math.round(httpScore);
    wsScore = Math.round(wsScore);

    const overall = dnsScore + tcpScore + httpScore + wsScore; // max ~28. We scale to 100%
    const percentage = Math.round((overall / 28) * 100);
    const medianLatency = latencies.length > 0 ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : 0;
    const stars = Math.round(percentage / 20);

    let emoji = '🔴';
    if (percentage >= 70) emoji = '🟢';
    else if (percentage >= 40) emoji = '🟡';

    const starStr = '★'.repeat(stars) + '☆'.repeat(5 - Math.min(stars, 5));
    const humanLine = `${emoji} ${percentage}% ${starStr} ${medianLatency}ms · DNS ${dnsScore}/10 TCP ${tcpScore}/10 HTTP ${httpScore}/7 WS ${wsScore}/1`;

    return {
        percentage,
        humanLine,
        medianLatency,
        measurements, // passing raw measurements for X-ray
        timestamp: Date.now()
    };
});
// Network detection
ipcMain.handle('get-network-info', async () => {
  try {
    let ssid = '';
    const wlanStr = await execPromise('netsh wlan show interfaces');
    const ssidMatch = wlanStr.match(/^\s*SSID\s*:\s*(.*)/m);
    if (ssidMatch) ssid = ssidMatch[1].trim();

    let ip = '';
    try {
        const res = await fetch('https://api.ipify.org?format=json', { timeout: 3000 });
        const data = await res.json();
        ip = data.ip;
    } catch(e) {}

    return { ssid, ip, fingerprint: `${ssid}-${ip}` };
  } catch(e) {
    return { ssid: '', ip: '', fingerprint: '' };
  }
});

// Diagnostics / X-Ray
ipcMain.handle('run-diagnostics', async (event, measurements) => {
    let findings = [];
    let dangerCount = 0;
    let warningCount = 0;

    if (measurements) {
        for (const [host, m] of Object.entries(measurements)) {
            // DNS spoofed by provider
            if (!m.dnsSystem && m.dnsDoH) {
                findings.push({ level: 'danger', message: `DNS spoofed for ${host} (recommend DoH/own DNS)` });
                dangerCount++;
            }
            // DNS fully blocked
            if (!m.dnsSystem && !m.dnsDoH) {
                findings.push({ level: 'danger', message: `DNS fully blocked for ${host}` });
                dangerCount++;
            }
            // IP-level block / TCP reset
            if ((m.dnsSystem || m.dnsDoH) && m.tcp === 0) {
                findings.push({ level: 'warning', message: `IP-level block / TCP reset for ${host} (recommend disorder/fragment/fake-tls)` });
                warningCount++;
            }
            // DPI blocks HTTPS by SNI
            if (m.tcp > 0 && !m.http && host !== 'gateway.discord.gg') {
                findings.push({ level: 'warning', message: `DPI blocks HTTPS by SNI for ${host} (recommend fake-tls/split-pos)` });
                warningCount++;
            }
        }

        // Specific checks
        const yt = measurements['youtube.com'];
        const gv = measurements['googlevideo.com'];
        if (yt && gv && yt.tcp > 0 && gv.tcp === 0) {
             findings.push({ level: 'warning', message: 'Googlevideo blocked separately (recommend ipset Google ranges)' });
             warningCount++;
        }

        const disc = measurements['discord.com'];
        const gw = measurements['gateway.discord.gg'];
        if (gw && gw.tcp > 0 && !gw.ws) {
            findings.push({ level: 'warning', message: 'Discord gateway WebSocket blocked (voice/video won\'t work)' });
            warningCount++;
        }
        if (disc && gw && disc.tcp > 0 && gw.tcp === 0) {
            findings.push({ level: 'info', message: 'gateway blocked separately' });
        }
    }

    if (findings.length === 0) {
        findings.push({ level: 'ok', message: 'network clean' });
    }

    // System diagnostics
    const bfe = await execPromise('sc query bfe');
    const isBfeRunning = bfe.includes('RUNNING');

    let sysProxy = false;
    try {
        const proxyReg = await execPromise('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable');
        sysProxy = proxyReg.includes('0x1');
    } catch(e) {}

    const vpns = await execPromise('tasklist');
    const hasVpn = vpns.includes('openvpn.exe') || vpns.includes('wireguard.exe');

    return {
        findings,
        dangerCount,
        warningCount,
        system: {
            bfeRunning: isBfeRunning,
            proxyEnabled: sysProxy,
            vpnRunning: hasVpn
        }
    };
});

ipcMain.handle('read-settings', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) {}
  return null;
});

ipcMain.handle('write-settings', (event, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('read-scores', () => getScores());

ipcMain.handle('write-scores', (event, scores) => {
  saveScores(scores);
  return true;
});

ipcMain.handle('read-log', () => {
    try {
        if (fs.existsSync(logPath)) {
            return fs.readFileSync(logPath, 'utf-8');
        }
    } catch (e) {}
    return '';
});

ipcMain.handle('read-list', (event, filepath) => {
    try {
        if (fs.existsSync(filepath)) {
            return fs.readFileSync(filepath, 'utf-8');
        }
    } catch (e) {}
    return '';
});

ipcMain.handle('write-list', (event, filepath, content) => {
    try {
        fs.writeFileSync(filepath, content, 'utf-8');
        return true;
    } catch (e) { return false; }
});

ipcMain.handle('minimize-to-tray', () => {
    if (mainWindow) {
        mainWindow.hide();
    }
});
// Autopilot logic (basic implementation)
setInterval(async () => {
    try {
        const settings = await ipcMain.handlers['read-settings']({});
        if (settings && settings.apEnabled) {
            // we will need to store last check time. In real implementation we'd track timestamp
            // For now, this is a skeleton for autopilot checking
            // ...
        }
    } catch(e) {}
}, 60000);

// Add extract-zip to download and extract zapret zip
const fs_promises = require('fs/promises');

ipcMain.handle('download-and-extract-zapret', async (event, destPath) => {
    try {
        log("Downloading latest zapret release...");
        const res = await fetch('https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest');
        const data = await res.json();
        const asset = data.assets.find(a => a.name.endsWith('.zip'));

        if (!asset) {
            log("No zip asset found in release.");
            return false;
        }

        const zipUrl = asset.browser_download_url;
        const zipRes = await fetch(zipUrl);

        const zipPath = path.join(appDir, 'zapret_temp.zip');
        const fileStream = fs.createWriteStream(zipPath);

        await new Promise((resolve, reject) => {
            zipRes.body.pipe(fileStream);
            zipRes.body.on("error", reject);
            fileStream.on("finish", resolve);
        });

        log("Extracting zapret...");
        // Since we don't have extract-zip installed, we will use powershell Expand-Archive which is native to Windows 10/11
        await execPromise(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destPath}' -Force"`);

        fs.unlinkSync(zipPath); // clean up
        log("Extraction complete.");
        return true;
    } catch(e) {
        log("Download/Extract error: " + e.message);
        return false;
    }
});
