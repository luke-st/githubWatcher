import { Database } from "bun:sqlite";
// Create a new SQLite database file
const db = new Database('githubWatcher.sqlite');

// Create the 'repos' table
db.query(`
  CREATE TABLE IF NOT EXISTS repos (
    owner TEXT,
    name TEXT,
    branch TEXT,
    buildCommand TEXT,
    pm2Command TEXT,
    caddyConfig TEXT
  )
`).run();

// Create the 'webhooks' table
db.query(`
  CREATE TABLE IF NOT EXISTS webhooks (
    name TEXT,
    owner TEXT
  )
`).run();

console.log('Database and tables created successfully.');

// Close the database connection
db.close();
