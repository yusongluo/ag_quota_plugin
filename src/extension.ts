import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const REFRESH_INTERVAL_MS = 60 * 1000; // Check every minute

let myStatusBarItem: vscode.StatusBarItem;
let interval: NodeJS.Timeout;
let selectedModelName: string | undefined;

// --- CONFIGURATION ---
const CMD_SHOW_DETAILS = 'antigravity.quota.showDetails';
const CMD_SHOW_RAW = 'antigravity.quota.showRawData';
const CMD_SET_SELECTED = 'antigravity.quota.setSelected';
// ---------------------

export function activate(context: vscode.ExtensionContext) {
    // Restore state
    selectedModelName = context.globalState.get('antigravity.quota.selectedModel');

    // Internal command to set selection from the UI
    context.subscriptions.push(vscode.commands.registerCommand(CMD_SET_SELECTED, (label: string | undefined) => {
        selectedModelName = label;
        context.globalState.update('antigravity.quota.selectedModel', label);

        if (label) {
            vscode.window.setStatusBarMessage(`Antigravity Quota: Monitoring ${label}`, 3000);
        } else {
            vscode.window.setStatusBarMessage(`Antigravity Quota: Auto-Monitoring (Lowest)`, 3000);
        }

        updateUsage();
    }));

    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand(CMD_SHOW_DETAILS, () => showDetails(context)));
    context.subscriptions.push(vscode.commands.registerCommand(CMD_SHOW_RAW, showRawData));

    // Create Status Bar Item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = CMD_SHOW_DETAILS;
    context.subscriptions.push(myStatusBarItem);

    // Update immediately and then every X minutes
    updateUsage();
    interval = setInterval(updateUsage, REFRESH_INTERVAL_MS);
}

export function deactivate() {
    if (interval) {
        clearInterval(interval);
    }
}

async function updateUsage() {
    try {
        const data = await fetchFullUserStatus();

        if (!data) {
            myStatusBarItem.text = '$(error) Quota: Error';
            myStatusBarItem.tooltip = 'Could not fetch quota data. Is Antigravity running?';
            myStatusBarItem.show();
            return;
        }

        // 1. Calculate Global Credit Percentage (The "Floor")
        let globalCreditPerc = 100;
        let globalStats = "Unknown";
        if (data.planStatus) {
            const { availablePromptCredits, availableFlowCredits, planInfo } = data.planStatus;
            const totalPrompt = planInfo?.monthlyPromptCredits || 1;
            const totalFlow = planInfo?.monthlyFlowCredits || 1;

            const promptPerc = Math.round((availablePromptCredits / totalPrompt) * 100);
            const flowPerc = Math.round((availableFlowCredits / totalFlow) * 100);

            globalCreditPerc = Math.min(promptPerc, flowPerc);
            globalStats = `Credits: P: ${availablePromptCredits}/${totalPrompt} | F: ${availableFlowCredits}/${totalFlow}`;
        }

        // 2. Process Models
        const quotas = data.cascadeModelConfigData?.clientModelConfigs || [];
        const processedModels = quotas.map((m: any) => {
            const label = m.label || m.model || 'Unknown';
            const info = m.quotaInfo || {};

            let perc: number;
            let source: string;

            if (typeof info.remainingFraction === 'number') {
                // Specific quota exists, use it directly (do not clamp by global)
                perc = Math.round(info.remainingFraction * 100);
                source = "Specific Quota";
            } else if (typeof m.usage === 'number' && typeof m.limit === 'number' && m.limit > 0) {
                const usagePerc = Math.round(((m.limit - m.usage) / m.limit) * 100);
                perc = usagePerc;
                source = "Usage Limit";
            } else {
                // Fallback to global credits
                perc = globalCreditPerc;
                source = "Global Plan Credits";
            }

            return { label, perc, source, raw: m };
        });

        // 3. Determine what to show
        let targetModel = processedModels[0]; // Default to something

        if (selectedModelName) {
            const found = processedModels.find((m: any) => m.label === selectedModelName);
            if (found) {
                targetModel = found;
            } else {
                // Previously selected model not found, maybe show warning or default common one
                targetModel = processedModels.find((m: any) => m.label.includes("Gemini")) || processedModels[0];
            }
        } else {
            // Auto-select logic: Find the "worst" one
            targetModel = processedModels.reduce((prev: any, curr: any) =>
                curr.perc < prev.perc ? curr : prev
                , processedModels[0]);
        }

        if (!targetModel) {
            // Fallback if no models found at all
            updateStatusBar("Credits", globalCreditPerc, globalStats);
            return;
        }

        // Color coding
        let colorTheme = undefined;
        let bgColor = undefined;

        if (targetModel.perc > 50) {
            colorTheme = new vscode.ThemeColor('statusBarItem.prominentForeground');
        } else if (targetModel.perc > 20) {
            bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }

        myStatusBarItem.color = colorTheme;
        myStatusBarItem.backgroundColor = bgColor;

        myStatusBarItem.text = `$(rocket) ${targetModel.label}: ${targetModel.perc}%`;
        myStatusBarItem.tooltip = `Model: ${targetModel.label}\nRemaining: ${targetModel.perc}% (${targetModel.source})\n\n${globalStats}\n\nClick to select model or see details.`;
        myStatusBarItem.show();

    } catch (e) {
        console.error(e);
        myStatusBarItem.text = '$(error) Quota';
        myStatusBarItem.show();
    }
}

function updateStatusBar(label: string, percentage: number, tooltipExtra: string) {
    if (percentage > 50) {
        myStatusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        myStatusBarItem.backgroundColor = undefined;
    } else if (percentage > 20) {
        myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    myStatusBarItem.text = `$(rocket) ${label}: ${percentage}%`;
    myStatusBarItem.tooltip = `Quota Remaining: ${percentage}%\n${tooltipExtra}\n\nClick for details.`;
    myStatusBarItem.show();
}

async function showDetails(context: vscode.ExtensionContext) {
    const data = await fetchFullUserStatus();
    if (!data) return;

    // Recalculate global for display
    let globalCreditPerc = 100;
    if (data.planStatus) {
        const { availablePromptCredits, availableFlowCredits, planInfo } = data.planStatus;
        const totalPrompt = planInfo?.monthlyPromptCredits || 1;
        const totalFlow = planInfo?.monthlyFlowCredits || 1;
        const promptPerc = Math.round((availablePromptCredits / totalPrompt) * 100);
        const flowPerc = Math.round((availableFlowCredits / totalFlow) * 100);
        globalCreditPerc = Math.min(promptPerc, flowPerc);
    }

    const items: vscode.QuickPickItem[] = [];
    const modelLookup = new Map<vscode.QuickPickItem, string>(); // Safe lookup for model names

    // Commands
    const rawDataItem: vscode.QuickPickItem = { label: '$(json) Show Raw Data' };
    items.push(rawDataItem);
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

    // Option to reset/auto selection
    const autoItem: vscode.QuickPickItem = {
        label: 'Auto (Lowest Usage)',
        description: 'Monitor the model with least quota'
    };
    items.push(autoItem);

    const quotas = data.cascadeModelConfigData?.clientModelConfigs || [];
    for (const m of quotas) {
        const info = m.quotaInfo || {};
        const label = m.label || m.model || 'Unknown';

        let perc: number;
        let note: string;

        if (typeof info.remainingFraction === 'number') {
            perc = Math.round(info.remainingFraction * 100);
            note = "Specific Quota";
        } else if (typeof m.usage === 'number' && typeof m.limit === 'number' && m.limit > 0) {
            const usagePerc = Math.round(((m.limit - m.usage) / m.limit) * 100);
            perc = usagePerc;
            note = "Usage Limit";
        } else {
            perc = globalCreditPerc;
            note = `Global Credits (${perc}%)`;
        }

        let icon = '$(check)';
        if (perc <= 20) icon = '$(error)';
        else if (perc <= 50) icon = '$(warning)';

        // Mark currently selected
        if (selectedModelName === label) {
            icon = '$(pin)';
            note = `[Active] ${note}`;
        }

        const item: vscode.QuickPickItem = {
            label: `${icon} ${label}`,
            description: `${perc}% remaining`,
            detail: `${note}`
        };

        items.push(item);
        modelLookup.set(item, label); // Store mapping safely
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a model to pin to Status Bar, or view details'
    });

    if (picked) {
        if (picked === rawDataItem) {
            vscode.commands.executeCommand(CMD_SHOW_RAW);
        } else if (picked === autoItem) {
            vscode.commands.executeCommand(CMD_SET_SELECTED, undefined);
        } else {
            // Check lookup map
            const modelName = modelLookup.get(picked);
            if (modelName) {
                vscode.commands.executeCommand(CMD_SET_SELECTED, modelName);
            } else {
                vscode.window.showErrorMessage("Could not determine model from selection.");
            }
        }
    }
}

// Reuse the fetch logic
async function showRawData() {
    vscode.window.showInformationMessage('Fetching raw quota data...');
    try {
        const data = await fetchFullUserStatus();
        const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(data, null, 2),
            language: 'json'
        });
        await vscode.window.showTextDocument(doc);
    } catch (e) {
        vscode.window.showErrorMessage('Failed to fetch raw data: ' + e);
    }
}

// Returns the full userStatus object
async function fetchFullUserStatus(): Promise<any> {
    try {
        if (process.platform === 'win32') {
            return await fetchQuotasWindows();
        } else {
            return null;
        }
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function fetchQuotasWindows(): Promise<any> {
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"`;

    try {
        const { stdout } = await execAsync(psCmd);
        if (!stdout || !stdout.trim()) return null;

        let processes: any[] = [];
        try {
            const parsed = JSON.parse(stdout);
            processes = Array.isArray(parsed) ? parsed : [parsed];
        } catch { return null; }

        for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const csrfMatch = cmdLine.match(/--csrf_token[=\s]+([^\s"']+)/);
            if (!csrfMatch) continue;

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
                            'X-Codeium-Csrf-Token': csrf,
                            'Connect-Protocol-Version': '1',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" }
                        })
                    });
                    if (res.ok) {
                        const data = await res.json() as any;
                        if (data && data.userStatus) {
                            return data.userStatus;
                        }
                    }
                } catch { }
            }
        }
    } catch (e) { console.error('Windows fetch error', e); }
    return null;
}
