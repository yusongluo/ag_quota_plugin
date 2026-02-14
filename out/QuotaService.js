"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotaService = void 0;
const vscode = require("vscode");
class QuotaService {
    constructor() {
        this._onDidUpdate = new vscode.EventEmitter();
        this.onDidUpdate = this._onDidUpdate.event;
        this._totalLimit = 1000;
        this._currentUsage = 0;
        this.loadConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity.quota')) {
                this.loadConfig();
            }
        });
    }
    loadConfig() {
        const config = vscode.workspace.getConfiguration('antigravity.quota');
        this._totalLimit = config.get('limit', 1000);
        const enableMock = config.get('mockUsage', true);
        if (enableMock) {
            this.startMockData();
        }
        else {
            this.stopMockData();
        }
    }
    startMockData() {
        if (this._mockInterval) {
            return;
        }
        // Increment usage every 2 seconds
        this._mockInterval = setInterval(() => {
            this._currentUsage += 20; // +2% per tick (assumes 1000 limit)
            if (this._currentUsage > this._totalLimit) {
                this._currentUsage = 0; // Reset
            }
            this._onDidUpdate.fire();
        }, 2000);
    }
    stopMockData() {
        if (this._mockInterval) {
            clearInterval(this._mockInterval);
            this._mockInterval = undefined;
        }
    }
    getUsagePercentage() {
        return Math.min(100, Math.round((this._currentUsage / this._totalLimit) * 100));
    }
    getUsageDetails() {
        // Mock breakdown
        const gptUsage = Math.round(this._currentUsage * 0.7);
        const geminiUsage = this._currentUsage - gptUsage;
        return [
            { modelName: 'GPT-4', used: gptUsage, limit: this._totalLimit },
            { modelName: 'Gemini Pro', used: geminiUsage, limit: this._totalLimit }
        ];
    }
}
exports.QuotaService = QuotaService;
//# sourceMappingURL=QuotaService.js.map