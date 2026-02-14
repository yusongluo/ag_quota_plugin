"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const REFRESH_INTERVAL_MS = 60 * 1000; // Check every minute
let myStatusBarItem;
let interval;
function activate(context) {
    // Register command to show details
    const cmdId = 'antigravity.quota.showDetails';
    context.subscriptions.push(vscode.commands.registerCommand(cmdId, showDetails));
    // Create Status Bar Item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = cmdId;
    context.subscriptions.push(myStatusBarItem);
    // Update immediately and then every X minutes
    updateUsage();
    interval = setInterval(updateUsage, REFRESH_INTERVAL_MS);
}
function deactivate() {
    if (interval) {
        clearInterval(interval);
    }
}
async function updateUsage() {
    try {
        const quotas = await fetchQuotas();
        // Log raw data for debugging (visible in Debug Console / Output? No, distinct console needed or just rely on user checking Developer Tools)
        // We will log to console.log which shows up in "Log (Extension Host)" or "Developer Tools"
        console.log('Antigravity Raw Quotas:', JSON.stringify(quotas, null, 2));
        if (quotas.length === 0) {
            myStatusBarItem.text = '$(error) Quota: Error';
            myStatusBarItem.tooltip = 'Could not fetch quota data. Is Antigravity running?';
            myStatusBarItem.show();
            return;
        }
        // Find the "bottleneck" model (lowest remaining percentage)
        // If remainingFraction is 1 (100%), it might mean "unused" or "data missing".
        // user reports 100% even when used. usage field might be present.
        let worstModel = quotas[0];
        let minPerc = 100;
        for (const m of quotas) {
            const info = m.quotaInfo || {};
            // Prefer remainingFraction if < 1. If 1, maybe check usage/limit?
            // The reddit post implies remainingFraction is the key.
            // But let's check if usage/limit exists.
            let perc = 100;
            if (typeof info.remainingFraction === 'number') {
                perc = Math.round(info.remainingFraction * 100);
            }
            else if (typeof m.usage === 'number' && typeof m.limit === 'number' && m.limit > 0) {
                // Fallback if structure is different
                perc = Math.round(((m.limit - m.usage) / m.limit) * 100);
            }
            if (perc < minPerc) {
                minPerc = perc;
                worstModel = m;
            }
        }
        // Color coding
        if (minPerc > 50) {
            myStatusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground'); // Default/White
            myStatusBarItem.backgroundColor = undefined;
        }
        else if (minPerc > 20) {
            myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        const label = worstModel.label || worstModel.model || 'AI';
        myStatusBarItem.text = `$(rocket) ${label}: ${minPerc}%`;
        myStatusBarItem.tooltip = `Click to see all quotas.\nLowest: ${label} (${minPerc}%)`;
        myStatusBarItem.show();
    }
    catch (e) {
        console.error(e);
        myStatusBarItem.text = '$(error) Quota';
        myStatusBarItem.show();
    }
}
async function showDetails() {
    const quotas = await fetchQuotas();
    const items = quotas.map(m => {
        const info = m.quotaInfo || {};
        const perc = typeof info.remainingFraction === 'number'
            ? Math.round(info.remainingFraction * 100)
            : 100;
        const reset = info.resetTime || 'N/A';
        const label = m.label || m.model || 'Unknown';
        // Icon
        let icon = '$(check)';
        if (perc <= 20)
            icon = '$(error)';
        else if (perc <= 50)
            icon = '$(warning)';
        return {
            label: `${icon} ${label}`,
            description: `${perc}% remaining`,
            detail: `Reset: ${reset} | Raw Fraction: ${info.remainingFraction}`
        };
    });
    vscode.window.showQuickPick(items, {
        placeHolder: 'Antigravity Model Quotas'
    });
}
// Reuse the fetch logic
async function fetchQuotas() {
    try {
        if (process.platform === 'win32') {
            return await fetchQuotasWindows();
        }
        else {
            return []; // Unix implementation skipped for now
        }
    }
    catch (e) {
        console.error(e);
        return [];
    }
}
async function fetchQuotasWindows() {
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"`;
    // ... (This part remains mostly same, just ensuring we capture all output) ...
    // Using a simpler parser for robustness
    try {
        const { stdout } = await execAsync(psCmd);
        if (!stdout || !stdout.trim())
            return [];
        let processes = [];
        try {
            const parsed = JSON.parse(stdout);
            processes = Array.isArray(parsed) ? parsed : [parsed];
        }
        catch {
            return [];
        }
        for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const csrfMatch = cmdLine.match(/--csrf_token[=\s]+([^\s"']+)/);
            if (!csrfMatch)
                continue;
            const csrf = csrfMatch[1];
            const pid = proc.ProcessId;
            const portsCmd = `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort"`;
            const { stdout: portsOut } = await execAsync(portsCmd);
            const ports = portsOut.trim().split(/\r?\n/).map(p => p.trim()).filter(p => p);
            for (const port of ports) {
                try {
                    const url = `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'X-Codeium-Csrf-Token': csrf, // Antigravity uses Codeium under the hood often?
                            'Connect-Protocol-Version': '1',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" }
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.userStatus?.cascadeModelConfigData?.clientModelConfigs) {
                            return data.userStatus.cascadeModelConfigData.clientModelConfigs;
                        }
                    }
                }
                catch { }
            }
        }
    }
    catch (e) {
        console.error('Windows fetch error', e);
    }
    return [];
}
//# sourceMappingURL=extension.js.map