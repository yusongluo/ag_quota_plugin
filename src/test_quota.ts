import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
    console.log("Fetching quotas...");
    try {
        const quotas = await fetchQuotasWindows();
        console.log(JSON.stringify(quotas, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}

async function fetchQuotasWindows(): Promise<any[]> {
    // 1. Find process
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"`;

    try {
        const { stdout } = await execAsync(psCmd);
        if (!stdout || !stdout.trim()) {
            console.log("No language_server process found.");
            return [];
        }

        let processes: any[] = [];
        try {
            const parsed = JSON.parse(stdout);
            processes = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            console.log("Failed to parse process JSON");
            return [];
        }

        for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const csrfMatch = cmdLine.match(/--csrf_token[=\s]+([^\s"']+)/);
            if (!csrfMatch) {
                console.log(`Process ${proc.ProcessId} found but no CSRF token.`);
                continue;
            }

            const csrf = csrfMatch[1];
            const pid = proc.ProcessId;
            console.log(`Found PID ${pid} with CSRF token.`);

            // 2. Find ports
            const portsCmd = `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort"`;
            const { stdout: portsOut } = await execAsync(portsCmd);
            const ports = portsOut.trim().split(/\r?\n/).map(p => p.trim()).filter(p => p);

            for (const port of ports) {
                console.log(`Checking port ${port}...`);
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

                        // Log userStatus WITHOUT the huge config data to see global fields
                        if (data.userStatus) {
                            const summary = { ...data.userStatus };
                            delete summary.cascadeModelConfigData;
                            console.log("User Status Summary:", JSON.stringify(summary, null, 2));
                        }

                        if (data?.userStatus?.cascadeModelConfigData?.clientModelConfigs) {
                            // usage found, but don't return it yet to keep output clean for summary check
                            return data.userStatus.cascadeModelConfigData.clientModelConfigs;
                        } else {
                            console.log(`Port ${port} returned data but not the expected structure:`, JSON.stringify(data, null, 2));
                        }
                    } else {
                        console.log(`Port ${port} failed with status ${res.status} ${res.statusText}`);
                    }
                } catch (e) {
                    console.log(`Port ${port} connection failed:`, e);
                }
            }
        }
    } catch (e) { console.error('Windows fetch error', e); }
    return [];
}

main();
