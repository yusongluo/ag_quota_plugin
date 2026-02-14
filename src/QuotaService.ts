import * as vscode from 'vscode';

export interface ModelUsage {
    modelName: string;
    used: number;
    limit: number;
}

export class QuotaService {
    private _onDidUpdate = new vscode.EventEmitter<void>();
    public readonly onDidUpdate = this._onDidUpdate.event;

    private _totalLimit: number = 1000;
    private _currentUsage: number = 0;
    private _mockInterval: NodeJS.Timeout | undefined;

    constructor() {
        this.loadConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity.quota')) {
                this.loadConfig();
            }
        });
    }

    private loadConfig() {
        const config = vscode.workspace.getConfiguration('antigravity.quota');
        this._totalLimit = config.get<number>('limit', 1000);
        const enableMock = config.get<boolean>('mockUsage', true);

        if (enableMock) {
            this.startMockData();
        } else {
            this.stopMockData();
        }
    }

    private startMockData() {
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

    private stopMockData() {
        if (this._mockInterval) {
            clearInterval(this._mockInterval);
            this._mockInterval = undefined;
        }
    }

    public getUsagePercentage(): number {
        return Math.min(100, Math.round((this._currentUsage / this._totalLimit) * 100));
    }

    public getUsageDetails(): ModelUsage[] {
        // Mock breakdown
        const gptUsage = Math.round(this._currentUsage * 0.7);
        const geminiUsage = this._currentUsage - gptUsage;
        return [
            { modelName: 'GPT-4', used: gptUsage, limit: this._totalLimit },
            { modelName: 'Gemini Pro', used: geminiUsage, limit: this._totalLimit }
        ];
    }
}
