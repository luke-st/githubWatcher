interface RepoConfig {
    owner: string;
    name: string;
    branch: string;
    buildCommand: string;
    pm2Command: string;
    caddyConfig: string;
}

interface WebhookRecord {
    name: string;
    owner: string;
}