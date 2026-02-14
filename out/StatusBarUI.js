"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarUI = void 0;
const vscode = require("vscode");
class StatusBarUI {
    constructor(service) {
        this._service = service;
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'antigravity.quota.showDetails';
        // Update initially and on subsequent events
        this.update();
        this._service.onDidUpdate(() => this.update());
        this._statusBarItem.show();
    }
    update() {
        const percentage = this._service.getUsagePercentage();
        const icon = '$(rocket)';
        const bar = this.getProgressBar(percentage);
        this._statusBarItem.text = `${icon} ${bar} ${percentage}%`;
        this._statusBarItem.tooltip = `AI Quota Usage: ${percentage}%`;
        // Color coding
        if (percentage >= 90) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        else if (percentage >= 75) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            this._statusBarItem.backgroundColor = undefined; // Default
        }
    }
    getProgressBar(percentage) {
        const totalChars = 10;
        const filledChars = Math.round((percentage / 100) * totalChars);
        const emptyChars = totalChars - filledChars;
        // Using block characters for a cleaner look
        const filled = '█'.repeat(filledChars);
        const empty = '░'.repeat(emptyChars);
        return `${filled}${empty}`;
    }
    dispose() {
        this._statusBarItem.dispose();
    }
}
exports.StatusBarUI = StatusBarUI;
//# sourceMappingURL=StatusBarUI.js.map