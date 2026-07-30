#!/usr/bin/env node
/**
 * Bumps the patch version in package.json (and mirrors it into package-lock.json).
 * Prints the new version to stdout. Called by .githooks/pre-commit and pre-push.
 *
 * Only the two lockfile fields that describe THIS package are touched — the
 * root "version" and packages[""].version. Dependency versions are left alone.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version || '');

if (!parsed) {
  console.error(`bump-version: cannot parse version "${pkg.version}" (want x.y.z)`);
  process.exit(1);
}

const next = `${parsed[1]}.${parsed[2]}.${Number(parsed[3]) + 1}`;

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = next;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

console.log(next);
