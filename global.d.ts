interface RepoConfig {
    owner: string;
    name: string;
    branch: string;
    buildCommand: string;
    pm2Command: string;
    caddyConfig: string;
    needsInstall: 0 | 1;
    isBun: 0 | 1;
    alreadyDeployed?: boolean;
}

interface WebhookRecord {
    name: string;
    owner: string;
}