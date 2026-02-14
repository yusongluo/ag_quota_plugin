import * as vscode from 'vscode';
import { QuotaService } from './QuotaService';

export class StatusBarUI {
    private _statusBarItem: vscode.StatusBarItem;
    private _service: QuotaService;

    constructor(service: QuotaService) {
        this._service = service;
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'antigravity.quota.showDetails';

        // Update initially and on subsequent events
        this.update();
        this._service.onDidUpdate(() => this.update());

        this._statusBarItem.show();
    }

    private update() {
        const percentage = this._service.getUsagePercentage();
        const icon = '$(rocket)';
        const bar = this.getProgressBar(percentage);

        this._statusBarItem.text = `${icon} ${bar} ${percentage}%`;
        this._statusBarItem.tooltip = `AI Quota Usage: ${percentage}%`;

        // Color coding
        if (percentage >= 90) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (percentage >= 75) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this._statusBarItem.backgroundColor = undefined; // Default
        }
    }

    private getProgressBar(percentage: number): string {
        const totalChars = 10;
        const filledChars = Math.round((percentage / 100) * totalChars);
        const emptyChars = totalChars - filledChars;

        // Using block characters for a cleaner look
        const filled = '█'.repeat(filledChars);
        const empty = '░'.repeat(emptyChars);

        return `${filled}${empty}`;
    }

    public dispose() {
        this._statusBarItem.dispose();
    }
}
