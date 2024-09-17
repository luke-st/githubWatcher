import { serve } from "bun";
import { Database } from "bun:sqlite";
import { mkdir, writeFile, rm, appendFile } from "node:fs/promises";
const { WEBHOOK_SECRET, GITHUB_TOKEN, REPO_DIR } = process.env as Record<string, string>;

if (!(await Bun.file('githubWatcher.sqlite').exists())) {
  throw new Error('DB not found. Init a new one with `Bun initDB.ts` or upload a DB to the root directory.');
}

const db = new Database('githubWatcher.sqlite');

if (!WEBHOOK_SECRET || !GITHUB_TOKEN || !REPO_DIR) {
  throw new Error('Env variables are not defined.');
}

function getRepoConfig(name: string, branch: string) {
  const query = db.query(`SELECT * FROM repos WHERE name = "${name}" AND branch = "${branch}"`);
  return query.get() as RepoConfig;
}

function setRepoConfig(config: RepoConfig) {
  const query = db.query(`
    INSERT INTO repos
    ("owner", "name", "branch", "buildCommand", "pm2Command", "caddyConfig", "needsInstall", "isBun") 
    VALUES 
    (?, ?, ?, ?, ?, ?, ?, ?);
  `);
  query.run(
    config.owner,
    config.name,
    config.branch,
    config.buildCommand,
    config.pm2Command,
    config.caddyConfig,
    config.needsInstall ? 1 : 0,
    config.isBun ? 1 : 0
  );
  console.log('Config saved');
}

function updateRepoConfig(config: RepoConfig) {
  const query = db.query(`
    UPDATE repos
    SET buildCommand = ?, pm2Command = ?, caddyConfig = ?, needsInstall = ?, isBun = ?
    WHERE owner = ? AND name = ? AND branch = ?
  `);
  
  query.run(
    config.buildCommand,
    config.pm2Command,
    config.caddyConfig,
    config.needsInstall ? 1 : 0,
    config.isBun ? 1 : 0,
    config.owner,
    config.name,
    config.branch
  );
  
  console.log('Config updated');
}

function checkForExistingWebooks(name: string, owner: string) {
  const query = db.query(`SELECT * FROM webhooks WHERE name = "${name}" AND owner = "${owner}"`);
  return !!query.get();
}

async function addWebhook(owner: string, name: string) {
  const body = {
    name: 'web',
    active: true,
    events: ['push'],
    config: {
      url: 'https://ghw.lukeste.dev',
      "content_type": 'json',
      "secret": WEBHOOK_SECRET,
      "insecure_ssl": 0
    }
  }
  const request = await fetch(`https://api.github.com/repos/${owner}/${name}/hooks`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (request.ok) {
    const saveToDB = db.query(`
      INSERT INTO webhooks
      ("name", "owner")
      VALUES
      ("${name}", "${owner}")
    `);
    saveToDB.run();
    console.log(`Webhook created for ${owner}/${name}`);
  } else {
    const error = await request.json();
    console.error('Webhook creation failed.');
    console.error(error);
  }
}

async function addToCaddyConfig(config: string) {
  await appendFile('~/Caddyfile', config);
  console.log('Caddyfile appended');
}

const publicKeyData = await Bun.file('public_key.bin').arrayBuffer();
const publicKey = await crypto.subtle.importKey(
  'raw',
  publicKeyData,
  {
    name: 'ECDSA',
    namedCurve: 'P-256',
  },
  true,
  ['verify']
);

// Ensure the repository directory exists
await mkdir(REPO_DIR, { recursive: true });

function verifySignature(payload: string, signature: string) {
    const hmac = new Bun.CryptoHasher('sha256');
    hmac.update(WEBHOOK_SECRET);
    const digest = Buffer.from(
        "sha256=" + hmac.update(payload).digest("hex"),
        "utf8"
    );
    return Buffer.compare(digest, Buffer.from(signature, "utf8")) === 0;
}

async function extractTar(tarPath: string, destPath: string) {
  console.log(`Extracting ${tarPath} to ${destPath}`);
  return new Promise<void>((resolve, reject) => {
    // tar -xzvf astro-blog.tar.gz -C astro-blog --strip-components 1
    const tar = Bun.spawn(['tar', '-xzf', tarPath, '-C', destPath, '--strip-components', '1'], {
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          resolve();
        } else reject(new Error(`tar command failed with code ${exitCode}`));
      }
    });
  });
}

async function runBuildCommand(command: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const subProcess = Bun.spawn(command.split(' '), {
      cwd,
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`Build command failed with code ${exitCode}`));
      }
    });
  });
}

async function runPm2Command(command: string, cwd: string, name: string) {
  return new Promise<void>((resolve, reject) => {
    const subProcess = Bun.spawn(['pm2', ...command.split(' '), '--name', name], {
      cwd,
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`PM2 command failed with code ${exitCode}`));
      }
    });
  });
}

async function runBunInstall(cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const subProcess = Bun.spawn(['bun', 'install'], {
      cwd,
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`Bun install command failed with code ${exitCode}`));
      }
    });
  });
}

async function runNpmInstall(cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const subProcess = Bun.spawn(['npm', 'install'], {
      cwd,
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`npm install command failed with code ${exitCode}`));
      }
    });
  });
}

async function runPm2Restart(name: string) {
  return new Promise<void>((resolve, reject) => {
    const subProcess = Bun.spawn(['pm2', 'restart', name], {
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`PM2 restart with code ${exitCode}`));
      }
    });
  });
}

async function formatAndReloadCaddy() {
  return new Promise<void>((resolve, reject) => {
    const format = Bun.spawn(['caddy', 'fmt'], {
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
        } else reject(new Error(`PM2 restart with code ${exitCode}`));
      }
    });
    const validate = Bun.spawn(['caddy', 'validate'], {
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
        } else reject(new Error(`PM2 restart with code ${exitCode}`));
      }
    });
    const reload = Bun.spawn(['caddy', 'reload'], {
      onExit(proc, exitCode, signalCode, error) {
        if (exitCode === 0) {
          console.log(proc.stdout);
          resolve();
        } else reject(new Error(`PM2 restart with code ${exitCode}`));
      }
    });
  });
}

async function processUpdate(repoName: string, branch: string, config: RepoConfig, alreadyDeployed: boolean) {
  const [owner, repo] = repoName.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`;
  const repoPath = `${REPO_DIR}/${repoName}`;
  const tarPath = `${repoPath}.tar.gz`;

  console.log(`Downloading ${repoName}...`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download repository: ${response.statusText}`);
  }

  const tarBuffer = await response.arrayBuffer();

  // Ensure the repo and temp directories exist
  await mkdir(repoPath, { recursive: true });

  // Write the tar file
  await writeFile(tarPath, Buffer.from(tarBuffer));

  console.log(`Extracting ${repoName}...`);

  // Extract the tar archive to repo directory
  await extractTar(tarPath, repoPath);

  console.log('Extracted.');

  // Remove the tar file
  await rm(tarPath);

  console.log('Deleted tar archive.');

  if (config.buildCommand?.length) {
    if (config.needsInstall) {
      switch (config.isBun) {
        case 0:
          console.log('Running npm install');
          await runNpmInstall(repoPath);
          console.log('npm install complete.');
          break;
        case 1:
          console.log('Running bun install');
          await runBunInstall(repoPath);
          console.log('bun install complete.');
          break;
      }
    }
    console.log('Running build command');
    await runBuildCommand(config.buildCommand, repoPath);
    console.log('Build completed.');
  }
  if (config.pm2Command?.length && !alreadyDeployed) {
    console.log('Running pm2 command');
    await runPm2Command(config.pm2Command, repoPath, config.name);
    console.log('pm2 command completed');
  } else if (config.pm2Command?.length && alreadyDeployed) {
    console.log('Already deployed in pm2. Restarting app');
    await runPm2Restart(config.name);
    console.log('Restarted.');
  }

  console.log(`Repository ${repoName} updated successfully.`);
}

async function handleAdminRequest(request: RepoConfig) {
  console.log(`Setting up repo: ${request.name}. Branch: ${request.branch}`);
  if (getRepoConfig(request.name, request.branch)) {
    console.warn('Config already exists for this branch. Updating...');
    updateRepoConfig(request);
  } else {
    setRepoConfig(request);
  }
  if (checkForExistingWebooks(request.name, request.owner)) {
    console.log('Repo already has an active webhook.');
    await processUpdate(`${request.owner}/${request.name}`, request.branch, request, request.alreadyDeployed || false);
  } else {
    await addWebhook(request.owner, request.name);
    // download the repo and run it.
    await processUpdate(`${request.owner}/${request.name}`, request.branch, request, request.alreadyDeployed || false);
    await addToCaddyConfig(request.caddyConfig);
    await formatAndReloadCaddy();
  }
}

const server = serve({
  port: 3000,
  async fetch(req) {
    // Only POSTs for now.
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    /*
    * If the signature is present in the header we assume it's from Github
    * and verify it to make sure.
    */
   const signature = req.headers.get("X-Hub-Signature-256");
   if (signature) {
      // Github webhook handling
      const body = await req.text();
      if (!verifySignature(body, signature)) {
        return new Response("Invalid signature", { status: 401 });
      }
      const event = JSON.parse(body);
      
      const repoName = event.repository.full_name.split('/').pop();
      const branch = event.ref.replace('/ref/heads/', '');
      const repoConfig = getRepoConfig(repoName, branch);
      if (!repoConfig) {
        console.error(`Github webhook recieved for repo:${repoName} branch:${branch} but it is not configured to be deployed.`);
        return new Response("Repo/Branch not configured. Request ignored.", { status: 200 });
      }
      try {
        await processUpdate(event.repository.full_name, branch, repoConfig, true);
        return new Response("Repository updated", { status: 200 });
      } catch (error) {
        console.error(`Error updating ${repoName}:`, error);
        return new Response("Error updating repository", { status: 500 });
      }
    }
    if (!signature) {
      // Admin action handling
      const { data, signature } = await req.json() as { data: string, signature: string };

      if (!data || !signature) {
        return new Response(JSON.stringify({ error: 'Missing data or signature' }), { status: 400 });
      }

      try {
        const isValid = await crypto.subtle.verify(
          {
            name: 'ECDSA',
            hash: { name: 'SHA-256' },
          },
          publicKey,
          new Uint8Array(Buffer.from(signature, 'hex')),
          new TextEncoder().encode(data)
        );

        if (isValid) {
          const config = JSON.parse(data) as RepoConfig;
          await handleAdminRequest(config);
          return new Response(JSON.stringify({ message: 'Data received and verified' }));
        } else {
          return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 403 });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Error processing request' }), { status: 500 });
      }
    }
    return new Response(`Unauthorised Request. Your IP has been logged: ${this.requestIP(req)}`, { status: 401 });
  },
});

console.log(`Listening on http://localhost:${server.port}...`);