interface RepoConfig {
    owner: string;
    name: string;
    branch: string;
    buildCommand: string;
    pm2Command: string;
    caddyConfig: string;
    alreadyDeployed?: boolean;
}

interface WebhookRecord {
    name: string;
    owner: string;
}